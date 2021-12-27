'use strict';
const validateProjectName = require('validate-npm-package-name');
const chalk = require('chalk');
const https = require('https');
const semver = require('semver');
const { sync, default: spawn } = require('cross-spawn');

const checkAppName = (appName) => {
	const validationResult = validateProjectName(appName);
	if (!validationResult.validForNewPackages) {
		console.error(
			chalk.red(
				`Cannot create a project named ${chalk.green(
					`"${appName}"`
				)} because of npm naming restrictions:\n`
			)
		);
		[
			...(validationResult.errors || []),
			...(validationResult.warnings || []),
		].forEach((error) => {
			console.error(chalk.red(`  * ${error}`));
		});
		console.error(chalk.red('\nPlease choose a different project name.'));
		process.exit(1);
	}

	const dependencies = [
		'@babel/core',
		'@babel/node',
		'@babel/preset-env',
		'@babel/cli',
	].sort();
	if (dependencies.includes(appName)) {
		console.error(
			chalk.red(
				`Cannot create a project named ${chalk.green(
					`"${appName}"`
				)} because a dependency with the same name exists.\n` +
					`Due to the way npm works, the following names are not allowed:\n\n`
			) +
				chalk.cyan(dependencies.map((depName) => `  ${depName}`).join('\n')) +
				chalk.red('\n\nPlease choose a different project name.')
		);
		process.exit(1);
	}
};

const checkForLatestVersion = () => {
	return new Promise((resolve, reject) => {
		https
			.get(
				'https://registry.npmjs.org/-/package/@hackermans/make-babel/dist-tags',
				(res) => {
					if (res.statusCode === 200) {
						let body = '';
						res.on('data', (data) => (body += data));
						res.on('end', () => {
							resolve(JSON.parse(body).latest);
						});
					} else {
						reject(res.statusCode);
					}
				}
			)
			.on('error', (err) => {
				reject();
			});
	});
};

const isSafeToCreateProjectIn = (root, name) => {
	const validFiles = [
		'.DS_Store',
		'.git',
		'.gitattributes',
		'.gitignore',
		'.gitlab-ci.yml',
		'.hg',
		'.hgcheck',
		'.hgignore',
		'.idea',
		'.npmignore',
		'.travis.yml',
		'docs',
		'LICENSE',
		'README.md',
		'mkdocs.yml',
		'Thumbs.db',
	];
	// These files should be allowed to remain on a failed install, but then
	// silently removed during the next create.
	const errorLogFilePatterns = [
		'npm-debug.log',
		'yarn-error.log',
		'yarn-debug.log',
	];
	const isErrorLog = (file) => {
		return errorLogFilePatterns.some((pattern) => file.startsWith(pattern));
	};

	const conflicts = fs
		.readdirSync(root)
		.filter((file) => !validFiles.includes(file))
		// IntelliJ IDEA creates module files before CRA is launched
		.filter((file) => !/\.iml$/.test(file))
		// Don't treat log files from previous installation as conflicts
		.filter((file) => !isErrorLog(file));

	if (conflicts.length > 0) {
		console.log(
			`The directory ${chalk.green(name)} contains files that could conflict:`
		);
		console.log();
		for (const file of conflicts) {
			try {
				const stats = fs.lstatSync(path.join(root, file));
				if (stats.isDirectory()) {
					console.log(`  ${chalk.blue(`${file}/`)}`);
				} else {
					console.log(`  ${file}`);
				}
			} catch (e) {
				console.log(`  ${file}`);
			}
		}
		console.log();
		console.log(
			'Either try using a new directory name, or remove the files listed above.'
		);

		return false;
	}

	// Remove any log files from a previous installation.
	fs.readdirSync(root).forEach((file) => {
		if (isErrorLog(file)) {
			fs.removeSync(path.join(root, file));
		}
	});
	return true;
};

const canNpmReadCWD = () => {
	const cwd = process.cwd();
	let childOutput = null;
	try {
		childOutput = sync('npm', ['config', 'list']).output.join('');
	} catch (e) {
		return false;
	}
	if (typeof childOutput !== 'string') {
		return false;
	}

	const lines = childOutput.split('\n');
	// `npm config list` output includes `; cwd = ...`;
	const prefix = '; cwd = ';
	const line = lines.find((line) => line.startsWith(prefix));
	if (typeof line !== 'string') {
		return false;
	}
	const npmCWD = line.substring(prefix.length);
	if (npmCWD === cwd) {
		return true;
	}
	console.error(
		chalk.red(
			`Could not start an npm process in the right directory.\n\n` +
				`The current directory is: ${chalk.bold(cwd)}\n` +
				`However, a newly started npm process runs in: ${chalk.bold(
					npmCWD
				)}\n\n` +
				`This is probably caused by a misconfigured system terminal shell.`
		)
	);
	if (process.platform === 'win32') {
		console.error(
			chalk.red(`On Windows, this can usually be fixed by running:\n\n`) +
				`  ${chalk.cyan(
					'reg'
				)} delete "HKCU\\Software\\Microsoft\\Command Processor" /v AutoRun /f\n` +
				`  ${chalk.cyan(
					'reg'
				)} delete "HKLM\\Software\\Microsoft\\Command Processor" /v AutoRun /f\n\n` +
				chalk.red(`Try to run the above two lines in the terminal.\n`) +
				chalk.red(
					`To learn more about this problem, read: https://blogs.msdn.microsoft.com/oldnewthing/20071121-00/?p=24433/`
				)
		);
	}
	return false;
};

const install = (root, isYarn, pnp, dependencies, verbose, isOnline) => {
	return new Promise((resolve, reject) => {
		let command, args;
		if (isYarn) {
			command = 'yarnpkg';
			args = ['add', '--exact'];
			if (!isOnline) {
				args.push('--offline');
			}
			if (pnp) {
				args.push('--enable-pnp');
			}
			[].push(args, dependencies);
			// Explicitly set cwd() to work around issues like
			// Unfortunately we can only do this for Yarn because npm support for
			// equivalent --prefix flag doesn't help with this issue.
			// This is why for npm, we run checkThatNpmCanReadCwd() early instead.
			args.push('--cwd');
			args.push(root);

			if (!isOnline) {
				console.log(chalk.yellow('You appear to be offline.'));
				console.log(chalk.yellow('Falling back to the local Yarn cache.'));
				console.log();
			}
		} else {
			command = 'npm';
			args = [
				'install',
				'--no-audit',
				'--save-exact',
				'--loglevel',
				'error',
			].concat(dependencies);

			if (pnp) {
				console.log(
					`${chalk.yellow('NPM does not support PnP.')}\n ${chalk.green(
						'Falling back to regular install.'
					)}\n`
				);
			}
		}

		if (verbose) {
			args.push('--verbose');
		}

		const child = spawn(command, args, { stdio: 'inherit' });
		child.on('close', (code) => {
			if (code !== 0) {
				reject({
					command: `${command} ${args.join(' ')}`,
				});
				return;
			}
			resolve();
		});
	});
};

const run = (
	root,
	appName,
	version,
	verbose,
	originalDirectory,
	template,
	isYarn,
	pnp
) => {
	Promise.all([
		getInstallPackage(version, originalDirectory),
		getTemplateInstallPackage(template, originalDirectory),
	]).then(([packageToInstall, templateToInstall]) => {
		const allDependencies = ['react', 'react-dom', packageToInstall];

		console.log('Installing packages. This might take a couple of minutes.');

		Promise.all([
			getPackageInfo(packageToInstall),
			getPackageInfo(templateToInstall),
		])
			.then(([packageInfo, templateInfo]) =>
				checkIfOnline(useYarn).then((isOnline) => ({
					isOnline,
					packageInfo,
					templateInfo,
				}))
			)
			.then(({ isOnline, packageInfo, templateInfo }) => {
				let packageVersion = semver.coerce(packageInfo.version);

				const templatesVersionMinimum = '3.3.0';

				// Assume compatibility if we can't test the version.
				if (!semver.valid(packageVersion)) {
					packageVersion = templatesVersionMinimum;
				}

				// Only support templates when used alongside new react-scripts versions.
				const supportsTemplates = semver.gte(
					packageVersion,
					templatesVersionMinimum
				);
				if (supportsTemplates) {
					allDependencies.push(templateToInstall);
				} else if (template) {
					console.log('');
					console.log(
						`The ${chalk.cyan(packageInfo.name)} version you're using ${
							packageInfo.name === 'react-scripts' ? 'is not' : 'may not be'
						} compatible with the ${chalk.cyan('--template')} option.`
					);
					console.log('');
				}

				console.log(
					`Installing ${chalk.cyan('react')}, ${chalk.cyan(
						'react-dom'
					)}, and ${chalk.cyan(packageInfo.name)}${
						supportsTemplates ? ` with ${chalk.cyan(templateInfo.name)}` : ''
					}...`
				);
				console.log();

				return install(
					root,
					useYarn,
					usePnp,
					allDependencies,
					verbose,
					isOnline
				).then(() => ({
					packageInfo,
					supportsTemplates,
					templateInfo,
				}));
			})
			.then(async ({ packageInfo, supportsTemplates, templateInfo }) => {
				const packageName = packageInfo.name;
				const templateName = supportsTemplates ? templateInfo.name : undefined;
				checkNodeVersion(packageName);
				setCaretRangeForRuntimeDeps(packageName);

				const pnpPath = path.resolve(process.cwd(), '.pnp.js');

				const nodeArgs = fs.existsSync(pnpPath) ? ['--require', pnpPath] : [];

				await executeNodeScript(
					{
						cwd: process.cwd(),
						args: nodeArgs,
					},
					[root, appName, verbose, originalDirectory, templateName],
					`
			const init = require('${packageName}/scripts/init.js');
			init.apply(null, JSON.parse(process.argv[1]));
		  `
				);

				if (version === 'react-scripts@0.9.x') {
					console.log(
						chalk.yellow(
							`\nNote: the project was bootstrapped with an old unsupported version of tools.\n` +
								`Please update to Node >=14 and npm >=6 to get supported tools in new projects.\n`
						)
					);
				}
			})
			.catch((reason) => {
				console.log();
				console.log('Aborting installation.');
				if (reason.command) {
					console.log(`  ${chalk.cyan(reason.command)} has failed.`);
				} else {
					console.log(
						chalk.red('Unexpected error. Please report it as a bug:')
					);
					console.log(reason);
				}
				console.log();

				// On 'exit' we will delete these files from target directory.
				const knownGeneratedFiles = ['package.json', 'node_modules'];
				const currentFiles = fs.readdirSync(path.join(root));
				currentFiles.forEach((file) => {
					knownGeneratedFiles.forEach((fileToMatch) => {
						// This removes all knownGeneratedFiles.
						if (file === fileToMatch) {
							console.log(`Deleting generated file... ${chalk.cyan(file)}`);
							fs.removeSync(path.join(root, file));
						}
					});
				});
				const remainingFiles = fs.readdirSync(path.join(root));
				if (!remainingFiles.length) {
					// Delete target folder if empty
					console.log(
						`Deleting ${chalk.cyan(`${appName}/`)} from ${chalk.cyan(
							path.resolve(root, '..')
						)}`
					);
					process.chdir(path.resolve(root, '..'));
					fs.removeSync(path.join(root));
				}
				console.log('Done.');
				process.exit(1);
			});
	});
};

const checkNpmVersion = () => {
	let hasMinNpm = false;
	let npmVersion = null;
	try {
		npmVersion = execSync('npm --version').toString().trim();
		hasMinNpm = semver.gte(npmVersion, '6.0.0');
	} catch (err) {
		// ignore
	}
	return {
		hasMinNpm: hasMinNpm,
		npmVersion: npmVersion,
	};
};

const checkYarnVersion = () => {
	const minYarnPnp = '1.12.0';
	const maxYarnPnp = '2.0.0';
	let hasMinYarnPnp = false;
	let hasMaxYarnPnp = false;
	let yarnVersion = null;
	try {
		yarnVersion = execSync('yarnpkg --version').toString().trim();
		if (semver.valid(yarnVersion)) {
			hasMinYarnPnp = semver.gte(yarnVersion, minYarnPnp);
			hasMaxYarnPnp = semver.lt(yarnVersion, maxYarnPnp);
		} else {
			// Handle non-semver compliant yarn version strings, which yarn currently
			// uses for nightly builds. The regex truncates anything after the first
			// dash. See #5362.
			const trimmedYarnVersionMatch = /^(.+?)[-+].+$/.exec(yarnVersion);
			if (trimmedYarnVersionMatch) {
				const trimmedYarnVersion = trimmedYarnVersionMatch.pop();
				hasMinYarnPnp = semver.gte(trimmedYarnVersion, minYarnPnp);
				hasMaxYarnPnp = semver.lt(trimmedYarnVersion, maxYarnPnp);
			}
		}
	} catch (err) {
		// ignore
	}
	return {
		hasMinYarnPnp: hasMinYarnPnp,
		hasMaxYarnPnp: hasMaxYarnPnp,
		yarnVersion: yarnVersion,
	};
};

module.exports = {
	run,
	install,
	checkAppName,
	canNpmReadCWD,
	checkForLatestVersion,
	isSafeToCreateProjectIn,
	checkNpmVersion,
	checkYarnVersion,
};