'use strict';
const validateProjectName = require('validate-npm-package-name');
const chalk = require('chalk');
const https = require('https');
const semver = require('semver');
const { sync, default: spawn } = require('cross-spawn');
const {
	existsSync,
	readdirSync,
	removeSync,
	lstatSync,
	renameSync,
	copySync,
	writeFileSync,
	readFileSync,
} = require('fs-extra');
const path = require('path');

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

	const dependencies = ['@babel/core', '@babel/preset-env'].sort();
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
				const stats = lstatSync(path.join(root, file));
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
	readdirSync(root).forEach((file) => {
		if (isErrorLog(file)) {
			removeSync(path.join(root, file));
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
	verbose,
	originalDirectory,
	template,
	isYarn,
	pnp
) => {
	Promise.all([getTemplateInstallPackage(template, originalDirectory)]).then(
		([templateToInstall]) => {
			const allDependencies = ['@babel/core', '@babel/preset-env'];

			console.log('Installing packages. This might take a couple of minutes.');

			Promise.all([getPackageInfo(templateToInstall)])
				.then(([templateInfo]) =>
					checkIfOnline(isYarn).then((isOnline) => ({
						isOnline,
						templateInfo,
					}))
				)
				.then(({ isOnline, templateInfo }) => {
					allDependencies.push(templateToInstall);

					console.log(
						`Installing ${chalk.cyan('@babel/core')}, ${chalk.cyan(
							'@babel/preset-env'
						)}, with ${chalk.cyan(templateInfo.name)}`
					);
					console.log();

					return install(
						root,
						isYarn,
						pnp,
						allDependencies,
						verbose,
						isOnline
					).then(() => templateInfo);
				})
				.then(async ({ templateInfo }) => {
					const templateName = templateInfo.name;
					checkNodeVersion();

					const pnpPath = path.resolve(process.cwd(), '.pnp.js');

					const nodeArgs = existsSync(pnpPath) ? ['--require', pnpPath] : [];

					await initializeTemplate(
						root,
						appName,
						verbose,
						originalDirectory,
						templateName
					);
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
					const currentFiles = readdirSync(path.join(root));
					currentFiles.forEach((file) => {
						knownGeneratedFiles.forEach((fileToMatch) => {
							// This removes all knownGeneratedFiles.
							if (file === fileToMatch) {
								console.log(`Deleting generated file... ${chalk.cyan(file)}`);
								removeSync(path.join(root, file));
							}
						});
					});
					const remainingFiles = readdirSync(path.join(root));
					if (!remainingFiles.length) {
						// Delete target folder if empty
						console.log(
							`Deleting ${chalk.cyan(`${appName}/`)} from ${chalk.cyan(
								path.resolve(root, '..')
							)}`
						);
						process.chdir(path.resolve(root, '..'));
						removeSync(path.join(root));
					}
					console.log('Done.');
					process.exit(1);
				});
		}
	);
};

const initializeTemplate = (
	appPath,
	appName,
	verbose,
	originalDirectory,
	templateName,
	isYarn
) => {
	const appPackage = require(path.join(appPath, 'package.json'));
	if (!templateName) {
		console.log();
		console.error(`${chalk.red('A template was not provided.')}`);
		console.error(
			`Please note that global installs of ${chalk.cyan(
				'make-babel'
			)} are not supported.`
		);
		console.error(
			`You can fix this by running ${chalk.cyan(
				'npm uninstall -g @hackermans/make-babel'
			)} or ${chalk.cyan(
				'yarn global remove @hackermans/make-babel'
			)} and using ${chalk.cyan('npx @hackermans/make-babel')} instead.`
		);
		return;
	}

	const templatePath = path.dirname(
		require.resolve(`${templateName}/package.json`, { paths: [appPath] })
	);

	const templateJsonPath = path.join(templatePath, 'template.json');
	let templateJson = {};
	if (existsSync(templateJsonPath)) {
		templateJson = require(templateJsonPath);
	}
	const templatePackage = templateJson.package || {};

	// Keys to ignore in templatePackage
	const templatePackageBlacklist = [
		'name',
		'version',
		'description',
		'keywords',
		'bugs',
		'license',
		'author',
		'contributors',
		'files',
		'browser',
		'bin',
		'man',
		'directories',
		'repository',
		'peerDependencies',
		'bundledDependencies',
		'optionalDependencies',
		'engineStrict',
		'os',
		'cpu',
		'preferGlobal',
		'private',
		'publishConfig',
	];

	// Keys from templatePackage that will be merged with appPackage
	const templatePackageToMerge = ['dependencies', 'scripts'];

	// Keys from templatePackage that will be added to appPackage,
	// replacing any existing entries.
	const templatePackageToReplace = Object.keys(templatePackage).filter(
		(key) => {
			return (
				!templatePackageBlacklist.includes(key) &&
				!templatePackageToMerge.includes(key)
			);
		}
	);

	// Copy over some of the devDependencies
	appPackage.dependencies = appPackage.dependencies || {};

	// Setup the script rules
	const templateScripts = templatePackage.scripts || {};
	appPackage.scripts = Object.assign({}, templateScripts);

	// Update scripts for Yarn users
	if (isYarn) {
		appPackage.scripts = Object.entries(appPackage.scripts).reduce(
			(acc, [key, value]) => ({
				...acc,
				[key]: value.replace(/(npm run |npm )/, 'yarn '),
			}),
			{}
		);
	}
	// Add templatePackage keys/values to appPackage, replacing existing entries
	templatePackageToReplace.forEach((key) => {
		appPackage[key] = templatePackage[key];
	});

	writeFileSync(
		path.join(appPath, 'package.json'),
		JSON.stringify(appPackage, null, 2) + os.EOL
	);

	const readmeExists = existsSync(path.join(appPath, 'README.md'));
	if (readmeExists) {
		renameSync(
			path.join(appPath, 'README.md'),
			path.join(appPath, 'README.old.md')
		);
	}

	// Copy the files for the user
	const templateDir = path.join(templatePath, 'template');
	if (existsSync(templateDir)) {
		copySync(templateDir, appPath);
	} else {
		console.error(
			`Could not locate supplied template: ${chalk.green(templateDir)}`
		);
		return;
	}

	// modifies README.md commands based on user used package manager.
	if (isYarn) {
		try {
			const readme = readFileSync(path.join(appPath, 'README.md'), 'utf8');
			writeFileSync(
				path.join(appPath, 'README.md'),
				readme.replace(/(npm run |npm )/g, 'yarn '),
				'utf8'
			);
		} catch (err) {
			// Silencing the error. As it fall backs to using default npm commands.
		}
	}
};

const getTemplateInstallPackage = (template, originalDirectory) => {
	let templateToInstall = 'cra-template';
	if (template) {
		if (template.match(/^file:/)) {
			templateToInstall = `file:${path.resolve(
				originalDirectory,
				template.match(/^file:(.*)?$/)[1]
			)}`;
		} else if (
			template.includes('://') ||
			template.match(/^.+\.(tgz|tar\.gz)$/)
		) {
			// for tar.gz or alternative paths
			templateToInstall = template;
		} else {
			// Add prefix 'cra-template-' to non-prefixed templates, leaving any
			// @scope/ and @version intact.
			const packageMatch = template.match(/^(@[^/]+\/)?([^@]+)?(@.+)?$/);
			const scope = packageMatch[1] || '';
			const templateName = packageMatch[2] || '';
			const version = packageMatch[3] || '';

			if (
				templateName === templateToInstall ||
				templateName.startsWith(`${templateToInstall}-`)
			) {
				// Covers:
				// - cba-template
				// - @SCOPE/cba-template
				// - cba-template-NAME
				// - @SCOPE/cba-template-NAME
				templateToInstall = `${scope}${templateName}${version}`;
			} else if (version && !scope && !templateName) {
				// Covers using @SCOPE only
				templateToInstall = `${version}/${templateToInstall}`;
			} else {
				// Covers templates without the `cra-template` prefix:
				// - NAME
				// - @SCOPE/NAME
				templateToInstall = `${scope}${templateToInstall}-${templateName}${version}`;
			}
		}
	}

	return Promise.resolve(templateToInstall);
};

const checkNodeVersion = () => {
	const packageJsonPath = path.resolve(
		process.cwd(),
		'node_modules',
		'package.json'
	);

	if (!fs.existsSync(packageJsonPath)) {
		return;
	}

	const packageJson = require(packageJsonPath);
	if (!packageJson.engines || !packageJson.engines.node) {
		return;
	}

	if (!semver.satisfies(process.version, packageJson.engines.node)) {
		console.error(
			chalk.red(
				'You are running Node %s.\n' +
					'Make Babel requires Node %s or higher. \n' +
					'Please update your version of Node.'
			),
			process.version,
			packageJson.engines.node
		);
		process.exit(1);
	}
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
	getTemplateInstallPackage,
};