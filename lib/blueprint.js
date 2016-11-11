var snapshotResult = (function () {
  let process = {platform: 'darwin', argv: [], env: {}}
  let global = {process, WeakMap}
  let window = {}

  function require (modulePath) {
    if (!require.cache[modulePath]) {
      const module = {exports: {}}
      const dirname = modulePath.split('/').slice(0, -1).join('/')

      function define (callback) {
        callback(require, module.exports, module)
      }
      // Prevent cyclic requires by assigning an empty value to the cache before
      // evaluating the module definition.
      require.cache[modulePath] = {}
      if (require.definitions.hasOwnProperty(modulePath)) {
        require.definitions[modulePath](module.exports, module, modulePath, dirname, define)
      } else {
        module.exports = global.require(modulePath)
      }
      require.cache[modulePath] = module.exports
    }
    return require.cache[modulePath]
  }
  require.extensions = {}
  require.cache = {}
  require.definitions = {'foo': 'bar'}

  require(main)
  return {global, process, require}
})()
