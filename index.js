'use strict';
const commander = require('commander');
const fs = require('fs');
const path = require('path');
const os = require('os');
// const https = require('https');
const chalk = require('chalk');
const semver = require('semver');
const { ensureDirSync } = require('fs-extra');
const { isSafeToCreateProjectIn, canNpmReadCWD } = require('./util');
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
		.on('--help', () => {
			console.log(
				`${chalk.red('IMPORTANT: ')}${chalk.bold(
					'This does not work with PnP yet.'
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
	createApp(projectName, program.verbose, program.template, isYarn);
};

const createApp = (name, verbose, template, isYarn) => {
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
		version: '0.0.1',
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

	run(root, appName, verbose, originalDirectory, template, isYarn);
};