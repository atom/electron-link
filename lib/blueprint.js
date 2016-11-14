var snapshotResult = (function () {
  let process = {platform: 'darwin', argv: [], env: {}}
  let window = {}
  let global = {process, WeakMap}


  function customRequire (modulePath) {
    if (!customRequire.cache[modulePath]) {
      const module = {exports: {}}
      const dirname = modulePath.split('/').slice(0, -1).join('/')

      function define (callback) {
        callback(customRequire, module.exports, module)
      }
      // Prevent cyclic requires by assigning an empty value to the cache before
      // evaluating the module definition.
      customRequire.cache[modulePath] = {}
      if (customRequire.definitions.hasOwnProperty(modulePath)) {
        customRequire.definitions[modulePath](module.exports, module, modulePath, dirname, customRequire, define)
      } else {
        module.exports = require(modulePath)
      }
      customRequire.cache[modulePath] = module.exports
    }
    return customRequire.cache[modulePath]
  }
  customRequire.extensions = {}
  customRequire.cache = {}
  customRequire.definitions = {'foo': 'bar'}

  customRequire(main)
  return {global, window, process, customRequire}
})()
