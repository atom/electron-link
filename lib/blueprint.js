var snapshotResult = (function () {
  let process = {platform: 'darwin'}
  let global = {process}

  function require (modulePath) {
    if (!require.cache[modulePath]) {
      const module = {exports: {}}
      const dirname = modulePath.split('/').slice(0, -1).join('/')
      if (require.definitions.hasOwnProperty(modulePath)) {
        require.definitions[modulePath](module.exports, module, modulePath, dirname)
      } else {
        module.exports = global.require(modulePath)
      }

      require.cache[modulePath] = module.exports
    }
    return require.cache[modulePath]
  }
  require.cache = {}
  require.definitions = {'foo': 'bar'}

  require(main)
  return {global, process, require}
})()
