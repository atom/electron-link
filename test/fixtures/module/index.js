const a = require('./dir/a')
const b = require('./dir/subdir/b').b
const c = require('./dir/c')

global.initialize = function () {
  global.moduleInitialized = true
  return a() + b + require('a') + c.d
}
