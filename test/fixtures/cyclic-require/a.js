const b = require('./b')

global.cyclicRequire = function () {
  return {a: 'a', b: b.value, d: require('./d'), e: require('./e')}
}
