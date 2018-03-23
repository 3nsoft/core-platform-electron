const gulp = require("gulp");
const ts = require("gulp-typescript");
const shell = require("gulp-shell");
const fs = require('fs');
const rename = require("gulp-rename");
const delMod = require("del");

function readJSONFile(path) {
	return JSON.parse(fs.readFileSync(path, { encoding: 'utf8' }));
}

function writeJSONFile(path, json) {
	fs.writeFileSync(path, JSON.stringify(json, null, '  '),
		{ encoding: 'utf8', flag: 'wx' });
}

function folderExists(path) {
	try {
		return fs.statSync(path).isDirectory();
	} catch (err) {
		return false;
	}
}

function copy(src, dst, renameArg) {
	if (renameArg === undefined) {
		return () => gulp.src(src).pipe(gulp.dest(dst));
	} else {
		return () => gulp.src(src).pipe(rename(renameArg)).pipe(gulp.dest(dst));
	}
}

function del(paths) {
	return () => delMod(paths, { force: true });
}

// put file and folder names into object so that ctrl+space becomes useful
const f = {
	build_all: 'build/all',
	build_app: 'build/app',
	tsconfig: 'tsconfig.json',
	app_main: 'build/all/main.js',
	mock_main: 'build/all/mock/main-for-client.js',
	package_lock_json: 'package-lock.json',
	package_json: 'package.json',
	home_server: 'home-server',
	spec_server: 'spec-server',
}

// put task names into object so that ctrl+space becomes useful
const t = {
	build_all: 'build-all',	// compiles platform and ui apps
	run: 'run',		// starts electron platform app with all ui apps on it
	run_fast: 'run-fast',	// same as run, but skips rebuilding ui apps
	run_mock: 'run-mock',	// starts mock platform
	prep_test: 'prep-test',
	test: 'test',
	prep_app_for_dist: 'prep-app-for-dist',
}


//============================================================================
// 1. Compile code in this project (3NWeb platform), placing it into build/all
//============================================================================
function build_platform() {
	const tsProject = ts.createProject(f.tsconfig);
	const tsResult = tsProject.src().pipe(tsProject());
	return tsResult.js.pipe(gulp.dest(f.build_all));
}


//============================================================================
// 2. Build UI apps. They place themselves into build/all/apps
//============================================================================
function buildAppsTask(isMock = false) {
	const tasks = [];
	const apps = [ 'personal-client-desktop' ];
	if (!isMock) {
		apps.push('personal-client-start-app');
	}
	for (const appProject of apps) {
		tasks.push(done => (folderExists(`../${appProject}`) ?
			done() : done(`${appProject} is not a folder`)));
		tasks.push(shell.task(`cd ../${appProject} && npm run gulp build `));
	}
	return gulp.series.apply(gulp, tasks);
}
const build_apps = buildAppsTask();
const build_apps_mock = buildAppsTask(true);
gulp.task(t.build_all, gulp.series(build_platform, build_apps));


//============================================================================
// 3. Run or run as mock, after compilation build
//============================================================================
const dataDirLineParam = (() => {
	const param = '--data-dir';
	for (const arg of process.argv) {
		if (arg.startsWith(`${param}=`)) {
			const path = arg.substring(11);
			if (path.startsWith('/') || path.startsWith('.')) {
				return `${param}="${path}"`;
			} else {
				return `${param}="3NWeb ${path}"`;
			}
		}
	}
	return `${param}=3NWeb`;
})();
const logHttpLineParam = '--console-log-http';
const devToolsLineParam = '--devtools';
const start_app = shell.task(
	`electron ${f.app_main} ${logHttpLineParam} ${devToolsLineParam} ${dataDirLineParam}`);
const start_mock = shell.task(`electron ${f.mock_main} ${devToolsLineParam}`);
gulp.task(t.run, gulp.series(t.build_all, start_app));
gulp.task(t.run_fast, gulp.series(build_platform, start_app));
gulp.task(t.run_mock, gulp.series(build_platform, build_apps_mock, start_mock));


//============================================================================
// 4. Run tests
//============================================================================
const build_server = shell.task(`
	cd ../${folderExists(f.home_server) ? f.home_server : f.spec_server } && npm run build`);
gulp.task(t.prep_test, gulp.series(t.build_all, build_server));
gulp.task(t.test, gulp.series(build_platform,
	shell.task(`node build/all/tests/jasmine.js`)));


//============================================================================
// 5. Prepare app for builder, placing code and package info into build/app
//============================================================================
const copy_app = gulp.series(del(f.build_app), gulp.parallel(
	copy(`${f.build_all}/main.js`, f.build_app),
	...([ 'lib-client', 'lib-common', 'main', 'ui', 'apps', 'main.js' ].map(
		fold => copy(`${f.build_all}/${fold}/**/*`, `${f.build_app}/${fold}`)))
));
const packFieldsToCopy = [ 'name', 'version', 'description', 'author',
	'license', 'dependencies' ];
function prep_app_package_json(done) {
	const originalPack = readJSONFile(f.package_json);
	const appPack = {};
	for (const f of packFieldsToCopy) {
		appPack[f] = originalPack[f];
	}
	appPack.main = 'main.js';
	writeJSONFile(`${f.build_app}/package.json`, appPack);
	done();
}
function prep_app_package_lock_json(done) {
	const originalLock = readJSONFile(f.package_lock_json);
	const appLock = {};
	for (const field of Object.keys(originalLock)) {
		appLock[field] = (field === 'dependencies') ? {} : originalLock[field];
	}
	if (originalLock.dependencies) {
		for (const packName of Object.keys(originalLock.dependencies)) {
			const pack = originalLock.dependencies[packName];
			if (pack.dev || packName.startsWith('@types/')) { continue; }
			appLock.dependencies[packName] = pack;
		}
	}
	writeJSONFile(`${f.build_app}/package-lock.json`, appLock);
	done();
}
gulp.task(t.prep_app_for_dist, gulp.series(t.build_all, copy_app,
	prep_app_package_json, prep_app_package_lock_json));

//	XXX Note that similar thing can be done to pack mock, with devtools.



gulp.task("help", (cb) => {
	const h = `
Major tasks in this project:

 1) "run" - compiles this, startup app and client app projects, and runs the whole app.
 
 2) "run-mock" - compiles this and client app projects, and runs mock app.

 3) "prep-test" - this builds all necessary code for tests, picking all required for testing projects like server. 

 4) "test" - runs spectron's tests on compiled code

For building distributables, use command:
	npm run build [... electron-builder parameters]
`;
	console.log(h);
	cb();
});
gulp.task("default", gulp.series("help"));
