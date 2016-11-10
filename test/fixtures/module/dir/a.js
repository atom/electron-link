module.exports = function () {
  return 'a' + require('./subdir/b').b
}
