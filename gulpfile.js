var gulp = require('gulp');
var gutil = require('gulp-util');
var less = require('gulp-less');
var path = require('path');


var log_err = function() {
  var args = Array.prototype.slice.call(arguments);
  args.unshift("[BUILD ERROR]:");
  console.error.apply(undefined,args);
// in ES6:
//    log.debug.call(undefined,"Configurator", ...arguments);
};

gulp.task('less-styles', function(done) {
  gulp.src('public_build/*.less')
    .pipe(less({
      paths: [ path.join(__dirname, 'public_build/less', 'includes') ]
    }))
    .pipe(gulp.dest('./public/css'))
    .on('end', done);
});

gulp.task('default', ['less-styles']);