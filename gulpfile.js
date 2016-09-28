const gulp = require("gulp");
const ts = require("gulp-typescript");
const shell = require("gulp-shell");
const fs = require('fs');

const BUILD_FOLDER = 'build';
const DIST_FOLDER = 'dist';
const DIST_MOCK_FOLDER = 'dist-mock';
const ignoreTheseInDists = [ DIST_FOLDER, DIST_MOCK_FOLDER, 'src', 'build/tests', '3NWeb', '3NWeb-mock', '.gitignore', 'gulpfile.js', 'tsconfig.json' ];

// build task consists, at this moment, only of compilation stage
gulp.task("tsc", function() {
	var tsProject = ts.createProject("tsconfig.json");
	var tsResult = tsProject.src().pipe(ts(tsProject));
	return tsResult.js.pipe(gulp.dest(BUILD_FOLDER));
});
gulp.task('build', gulp.series('tsc'));

const APP_SCRIPT = 'build/main.js';
const MOCK_APP_SCRIPT = 'build/mock/mock-for-client.js';

// xxx-pack tasks change package.json's main, directing in to either
// mock, or main production scripts. 
const PACKAGE_FILE = 'package.json';
gulp.task('mock-pack', (cb) => {
	let packInfo = JSON.parse(fs.readFileSync(PACKAGE_FILE));
	packInfo.main = MOCK_APP_SCRIPT;
	fs.writeFileSync(PACKAGE_FILE, JSON.stringify(packInfo, null, '  '));
	cb();
});
gulp.task('prod-pack', (cb) => {
	let packInfo = JSON.parse(fs.readFileSync(PACKAGE_FILE));
	packInfo.main = APP_SCRIPT;
	fs.writeFileSync(PACKAGE_FILE, JSON.stringify(packInfo, null, '  '));
	cb();
});

function checkAppProject(appProject) {
	return (cb) => {
		let stat = fs.statSync(`../${appProject}`);
		if (stat.isDirectory()) {
			cb();
		} else {
			cb(`${appProject} is not a folder`);
		}
	};
}

function buildAppsTask(isMock = false) {
	let tasks = [];
	let apps = [ 'personal-client-desktop' ];
	if (!isMock) {
		apps.push('personal-client-start-app');
	}
	for (let appProject of apps) {
		tasks.push(checkAppProject(appProject));
		tasks.push(shell.task(`cd ../${appProject} ; npm run gulp build `));
	}
	return gulp.series.apply(gulp, tasks);
}

// tasks to run electron app, or a mock app
gulp.task('run-mock', gulp.series('build', buildAppsTask(true),
	shell.task(`electron ${MOCK_APP_SCRIPT}`)));
gulp.task('run', gulp.series('build', buildAppsTask(),
	shell.task(`electron ${APP_SCRIPT} --console-log-http`)));

const SERVER_FOLDER = 'home-server';

// tasks for testing
gulp.task('test', gulp.series('build',
	shell.task(`node build/tests/jasmine.js ; rm -f npm-debug.log`)));
gulp.task('prep-test', gulp.series('build',
	buildAppsTask(),
	shell.task(`cd ../${SERVER_FOLDER} ; npm run build`)));

/**
 * @param outDir is an output directory for complete binaries
 * @param platform is a string that indicates platform(s). Possible values are
 * 'linux', 'windows', 'darwin', 'mas', combination of these, concatinated with
 * a comma, or 'all', for all platforms. 
 * @param arch is a string that indicate architecture(s). Possible values are
 * 'x64', 'ia32', combination of these, concatinated with a comma, or 'all',
 * for all architectures. 
 * @param isMock is a boolean flag, which true value tells that distribution
 * binaries are create for mock, and false value (default) marks it as a
 * complete production distribution.
 * @return shell task that runs electron packager for given arguments.
 */
function distTask(outDir, platform, arch, isMock = false) {
	let filesToIgnore = isMock ?
		ignoreTheseInDists :
		ignoreTheseInDists.concat([ 'build/mock' ]);
	let ignoreClause = `--ignore=${filesToIgnore.join(' --ignore=')}`;
	return shell.task(`electron-packager . --platform=${platform} --arch=${arch} ${ignoreClause} --out=${outDir} --overwrite --prune`);
}

// these tasks build mock distributions
let mockDistChain = [ 'build', buildAppsTask(true),
	buildAppsTask(true), 'mock-pack' ];
gulp.task('dist-mock-linux', gulp.series.apply(gulp, mockDistChain.concat(
	distTask(DIST_MOCK_FOLDER, 'linux', 'x64', true)),
	'prod-pack'));
gulp.task('dist-mock-windows', gulp.series.apply(gulp, mockDistChain.concat(
	distTask(DIST_MOCK_FOLDER, 'win32', 'x64', true)),
	'prod-pack'));
gulp.task('dist-mock-darwin', gulp.series.apply(gulp, mockDistChain.concat(
	distTask(DIST_MOCK_FOLDER, 'darwin', 'all', true)),
	'prod-pack'));
gulp.task('dist-mock-all', gulp.series.apply(gulp, mockDistChain.concat(
	distTask(DIST_MOCK_FOLDER, 'all', 'all', true)),
	'prod-pack'));

// these tasks build production distributions
let distChain = [ 'build', buildAppsTask(), buildAppsTask(), 'prod-pack' ];
gulp.task('dist-linux', gulp.series.apply(gulp, distChain.concat(
	distTask(DIST_FOLDER, 'linux', 'x64'))));
gulp.task('dist-windows', gulp.series.apply(gulp, distChain.concat(
	distTask(DIST_FOLDER, 'win32', 'x64'))));
gulp.task('dist-darwin', gulp.series.apply(gulp, distChain.concat(
	distTask(DIST_FOLDER, 'darwin', 'all'))));
gulp.task('dist-all', gulp.series.apply(gulp, distChain.concat(
	distTask(DIST_FOLDER, 'all', 'all'))));

gulp.task("help", (cb) => {
	var h = `
Major tasks in this project:

 1) "run" - compiles this, startup app and client app projects, and runs the whole app.
 
 2) "run-mock" - compiles this and client app projects, and runs mock app.

 3) "dist-xxx" - where xxx can be linux, windows, darwin, or all. Compiles and packs x64 distribution files, while dist-all makes packs for all architectures.

 4) "dist-mock-xxx" - where xxx can be linux, windows, darwin, or all. Compiles and packs mock app x64 distribution files, while dist-mock-all makes packs for all architectures.

 5) "prep-test" - this builds all necessary code for tests, picking all required for testing projects like server. 

 6) "test" - initial simple test. In time there will be a few different test sets
`;
	console.log(h);
	cb();
});
gulp.task("default", gulp.series("help"));
