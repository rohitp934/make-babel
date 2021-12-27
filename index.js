'use strict';
const commander = require('commander');
const fs = require('fs');
const path = require('path');
const os = require('os');
// const https = require('https');
const chalk = require('chalk');
const semver = require('semver');
const { ensureDirSync } = require('fs-extra');
const {
	isSafeToCreateProjectIn,
	canNpmReadCWD,
	checkNpmVersion,
	checkYarnVersion,
} = require('./util');
const packageJson = require('./package.json');

const isUsingYarn = () => {
	return (process.env.npm_config_user_agent || '').indexOf('yarn') === 0;
};

let projectName;

const init = () => {
	const program = new commander.Command(packageJson.name)
		.version(packageJson.version)
		.arguments('<project-directory>')
		.usage(`${chalk.green('<project-directory>')} [options]`)
		.action((name) => {
			projectName = name;
		})
		.option('--verbose', 'print additional logs')
		.option('--info', 'print environment debug info')
		.option('--template', 'template name')
		.option('--pnp', 'uses Plug N Play')
		.on('--help', () => {
			console.log(
				`${chalk.red('IMPORTANT: ')}${chalk.bold(
					'Supports PnP, use --pnp to enable it'
				)}`
			);
			console.log(
				`    Only ${chalk.green('<project-directory>')} is required. \n`
			);
			console.log(`${chalk.cyan('--template')} can be one of:`);
			console.log(`    - JavaScript: ${chalk.green('js')}`);
			console.log(`    - TypeScript: ${chalk.green('ts')}`);
			console.log();
		})
		.parse(process.argv);

	if (typeof projectName === 'undefined') {
		console.error('Please specify the project directory:');
		console.log(
			`  ${chalk.cyan(program.name())} ${chalk.green('<project-directory>')}`
		);
		console.log();
		console.log('For example:');
		console.log(
			`  ${chalk.cyan(program.name())} ${chalk.green('sample-babel-app')}`
		);
		console.log();
		console.log(
			`Run ${chalk.cyan(`${program.name()} --help`)} to see all options.`
		);
		process.exit(1);
	}

	const isYarn = isUsingYarn();
	createApp(
		projectName,
		program.verbose,
		program.template,
		isYarn,
		program.pnp
	);
};

const createApp = (name, verbose, template, isYarn, pnp) => {
	const unsupportedNodeVersion = !semver.satisfies(
		semver.coerce(process.version, '>=12')
	);

	if (unsupportedNodeVersion) {
		console.log(
			chalk.yellow(
				'Unsupported Node version. Please upgrade to Node 12 or higher for a better experience.'
			)
		);
	}
	const root = path.resolve(name);
	const appName = path.basename(root);

	checkAppName(appName);
	ensureDirSync(appName);
	if (!isSafeToCreateProjectIn(root, appName)) {
		process.exit(1);
	}
	console.log(`\nCreating a new Babel App in ${chalk.green(root)}.\n`);

	const packageJson = {
		name: appName,
		version: '1.0.0',
		private: true,
	};
	fs.writeFileSync(
		path.join(root, 'package.json'),
		JSON.stringify(packageJson, null, 2) + os.EOL
	);

	const originalDirectory = process.cwd();
	process.chdir(root);
	if (!isYarn && !canNpmReadCWD()) {
		process.exit(1);
	}

	if (!useYarn) {
		const npmInfo = checkNpmVersion();
		if (!npmInfo.hasMinNpm) {
			if (npmInfo.npmVersion) {
				console.log(
					chalk.yellow(
						`You are using npm ${npmInfo.npmVersion} so the project will be bootstrapped with an old unsupported version of tools.\n\n` +
							`Please update to npm 6 or higher for a better, fully supported experience.\n`
					)
				);
			}
		}
	} else if (usePnp) {
		const yarnInfo = checkYarnVersion();
		if (yarnInfo.yarnVersion) {
			if (!yarnInfo.hasMinYarnPnp) {
				console.log(
					chalk.yellow(
						`You are using Yarn ${yarnInfo.yarnVersion} together with the --use-pnp flag, but Plug'n'Play is only supported starting from the 1.12 release.\n\n` +
							`Please update to Yarn 1.12 or higher for a better, fully supported experience.\n`
					)
				);
				// 1.11 had an issue with webpack-dev-middleware, so better not use PnP with it (never reached stable, but still)
				usePnp = false;
			}
			if (!yarnInfo.hasMaxYarnPnp) {
				console.log(
					chalk.yellow(
						'The --use-pnp flag is no longer necessary with yarn 2 and will be deprecated and removed in a future release.\n'
					)
				);
				// 2 supports PnP by default and breaks when trying to use the flag
				usePnp = false;
			}
		}
	}

	run(root, appName, version, verbose, originalDirectory, template, isYarn);
};
