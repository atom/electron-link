const b = require('./b')

module.exports = {a: 1, b: b.value}

global.cyclicRequire = module.exports
