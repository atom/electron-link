var snapshotResult = (function () {
  let process = {}
  Object.defineProperties(process, {
    'platform': {value: 'processPlatform', enumerable: false},
    'argv': {value: [], enumerable: false},
    'env': {value: {}, enumerable: false}
  })
  function get_process () {
    return process
  }

  let document = {}
  function get_document () {
    return document
  }

  let global = {}
  Object.defineProperties(global, {
    'document': {value: document, enumerable: false},
    'process': {value: process, enumerable: false},
    'WeakMap': {value: WeakMap, enumerable: false}
  })
  function get_global () {
    return global
  }

  let window = {}
  Object.defineProperties(window, {
    'document': {value: document, enumerable: false},
    'location': {value: {href: ''}, enumerable: false}
  })
  function get_window () {
    return window
  }

  let require = () => { throw new Error('To use Node require you need to call setGlobals on snapshotResult first!') }

  function customRequire (modulePath) {
    if (!customRequire.cache[modulePath]) {
      const module = {exports: {}}
      const dirname = modulePath.split('/').slice(0, -1).join('/')

      function define (callback) {
        callback(customRequire, module.exports, module)
      }

      if (customRequire.definitions.hasOwnProperty(modulePath)) {
        // Prevent cyclic requires by assigning an empty value to the cache before
        // evaluating the module definition.
        customRequire.cache[modulePath] = {}
        customRequire.definitions[modulePath].apply(module.exports, [module.exports, module, modulePath, dirname, customRequire, define])
      } else {
        module.exports = require(modulePath)
      }
      customRequire.cache[modulePath] = module.exports
    }
    return customRequire.cache[modulePath]
  }
  customRequire.extensions = {}
  customRequire.cache = {}
  customRequire.definitions = {}
  customRequire.resolve = function (mod) {
    return require.resolve(mod)
  }

  customRequire(mainModuleRequirePath)
  return {
    customRequire,
    setGlobals: function (newGlobal, newProcess, newWindow, newDocument, nodeRequire) {
      for (let key of Object.keys(global)) {
        newGlobal[key] = global[key]
      }
      global = newGlobal

      for (let key of Object.keys(process)) {
        newProcess[key] = process[key]
      }
      process = newProcess

      for (let key of Object.keys(window)) {
        newWindow[key] = window[key]
      }
      window = newWindow

      for (let key of Object.keys(document)) {
        newDocument[key] = document[key]
      }
      document = newDocument

      require = nodeRequire
    }
  }
})()
