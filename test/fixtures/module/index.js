const a = require('./dir/a')
const b = require('./dir/subdir/b').b
const c = require('./dir/c')

global.initialize = function () {
  return a() + b + require('a') + c.d
}
