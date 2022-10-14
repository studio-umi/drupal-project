// node-config で使用するディレクトリが Drupal のものと被るので読み込むディレクトリを指定。
process.env.NODE_CONFIG_DIR = `${__dirname}/config/`;

/* eslint-disable import/no-extraneous-dependencies */
const browsersync = require('browser-sync');
const config = require('config');
const { dest, lastRun, parallel, series, src, watch } = require('gulp');
const through = require('through2');
const plugins = require('gulp-load-plugins')();
/* eslint-enable */

const cssGlobs = `${config.webRoot}/{modules,themes}/custom/**/css/**/*.css`;
const jsGlobs = `${config.webRoot}/{modules,themes}/custom/**/js/**/*.es6.js`;
const scssGlobs = `${config.webRoot}/{modules,themes}/custom/**/css/**/*.scss`;
const twigGlobs = `${config.webRoot}/{modules,themes}/custom/**/templates/**/*.html.twig`;

function browsersyncStart(cb) {
  browsersync.create();
  browsersync.init(config.browsersync);
  cb();
}
exports['browsersync:start'] = browsersyncStart;

function browsersyncStream() {
  return src(cssGlobs, { since: lastRun(browsersyncStream) }).pipe(
    browsersync.stream(),
  );
}

function browsersyncReload(cb) {
  browsersync.reload();
  cb();
}

function buildScss() {
  const lastRunTime = lastRun(buildScss);
  let srcHasPartialFile = false;

  // トランスパイル時間を高速化するため _ から始まるパーシャルファイルが更新された場合は
  // すべての SCSS ファイルをトランスパイルし、そうでない場合は更新されたファイルだけを
  // 対象とする. パーシャルファイルが更新された場合に、それに関連する SCSS を追うことが
  // できないための処置. Gulp 4 の since オプションや gulp-changed ではこの様な振る舞いが
  // できないので自前で実装する.
  return src(scssGlobs, { sourcemaps: true })
    .pipe(
      through.obj((file, enc, callback) => {
        // 更新されたファイルの中に パーシャルファイルが無いか確認し、一つでもあれば
        // srcHasPartialFile のフラグを立てる.
        if (
          !srcHasPartialFile &&
          lastRunTime < file.stat.mtime &&
          file.path.match(/\/_[^/]+\.scss$/)
        ) {
          srcHasPartialFile = true;
        }
        callback(null, file);
      }),
    )
    .pipe(
      through.obj((file, enc, callback) => {
        // パーシャルファイルが対象に一つも無い場合のみ、ファイルの更新時間と前回の実行時間を
        // 比べて更新されてないファイルを対象から外す.
        if (!srcHasPartialFile && lastRunTime > file.stat.mtime) {
          file = null;
        }
        callback(null, file);
      }),
    )
    .pipe(
      plugins
        .dartSass({
          includePaths: ['node_modules/breakpoint-sass/stylesheets'],
          outputStyle: 'expanded',
        })
        .on('error', plugins.dartSass.logError),
    )
    .pipe(plugins.autoprefixer())
    .pipe(dest(`${config.webRoot}/`, { sourcemaps: '.' }));
}

function buildJs() {
  return src(jsGlobs, { since: lastRun(buildJs), sourcemaps: true })
    .pipe(plugins.plumber())
    .pipe(plugins.babel({ presets: ['@babel/preset-env'], comments: false }))
    .pipe(
      plugins.rename(path => {
        path.basename = path.basename.replace(/\.es6$/, '');
      }),
    )
    .pipe(dest(`${config.webRoot}/`, { sourcemaps: '.' }));
}

exports['build:scss'] = buildScss;
exports['build:js'] = buildJs;
exports.build = parallel(buildJs, buildScss);

function lintScss() {
  return src(scssGlobs).pipe(plugins.stylelint(config.stylelint));
}

function lintJs() {
  return src(jsGlobs)
    .pipe(plugins.eslint())
    .pipe(plugins.eslint.format())
    .pipe(plugins.eslint.failAfterError());
}

exports['lint:scss'] = lintScss;
exports['lint:js'] = lintJs;
exports.lint = parallel(lintJs, lintScss);

function watchScss() {
  const tasks = [buildScss];
  if (browsersync.instances.length) {
    tasks.push(browsersyncStream);
  }
  watch(scssGlobs, series(tasks));
}

function watchJs() {
  watch(jsGlobs, buildJs);
}

function watchTwig() {
  if (browsersync.instances.length) {
    watch(twigGlobs, browsersyncReload);
  }
}
exports['watch:scss'] = watchScss;
exports['watch:js'] = watchJs;
exports['watch:twig'] = watchTwig;

const defaultWatch = parallel(watchJs, watchScss, watchTwig);
exports.watch = defaultWatch;

exports.default = series(browsersyncStart, defaultWatch);
