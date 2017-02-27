const path = require('path')

module.exports = function () {
  return 'a' + require('./subdir/b').b + path.join('x', 'y')
}
