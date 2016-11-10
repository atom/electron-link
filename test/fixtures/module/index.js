const a = require('./dir/a')
const b = require('./dir/subdir/b').b

global.initialize = function () {
  return a() + b + require('a')
}
