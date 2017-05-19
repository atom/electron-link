var snapshotAuxiliaryData = {}

function generateSnapshot () {
  let process = {}
  Object.defineProperties(process, {
    'platform': {value: 'processPlatform', enumerable: false},
    'argv': {value: [], enumerable: false},
    'env': {value: {'NODE_ENV': 'production'}, enumerable: false}
  })
  function get_process () {
    return process
  }

  function createElement(_type) {
    return {
      innerHTML: '',
      style: {}
    }
  }

  let documentElement = {
    textContent: '',
    style: {
      cssFloat: ''
    }
  }
  let document = {}
  Object.defineProperties(document, {
    'createElement': {value: createElement, enumerable: false},
    'addEventListener': {value: function() {}, enumerable: false},
    'documentElement': {value: documentElement, enumerable: false},
    'oninput': {value: {}, enumerable: false},
    'onchange': {value: {}, enumerable: false}
  })
  function get_document () {
    return document
  }

  let global = {}
  Object.defineProperties(global, {
    'document': {value: document, enumerable: false},
    'process': {value: process, enumerable: false},
    'WeakMap': {value: WeakMap, enumerable: false},
    'isGeneratingSnapshot': {value: true, enumerable: false}
  })
  function get_global () {
    return global
  }

  let window = {}
  Object.defineProperties(window, {
    'document': {value: document, enumerable: false},
    'location': {value: {href: ''}, enumerable: false},
    'addEventListener': {value: function(){}, enumerable: false},
    'screen': {value: {}, enumerable: false},
  })
  function get_window () {
    return window
  }

  let console = {}
  function consoleNoop () {
    throw new Error('Cannot use `console` functions in the snapshot.')
  }
  Object.defineProperties(console, {
    'debug': {value: consoleNoop, enumerable: false},
    'error': {value: consoleNoop, enumerable: false},
    'info': {value: consoleNoop, enumerable: false},
    'log': {value: consoleNoop, enumerable: false},
    'warn': {value: consoleNoop, enumerable: false},
    'time': {value: consoleNoop, enumerable: false},
    'timeEnd': {value: consoleNoop, enumerable: false}
  })
  function get_console () {
    return console
  }

  let require = (moduleName) => {
    throw new Error(
      `Cannot require module "${moduleName}".\n` +
      "To use Node's require you need to call `snapshotResult.setGlobals` first!"
    )
  }

  function customRequire (modulePath) {
    let module = customRequire.cache[modulePath]
    if (!module) {
      module = {exports: {}}
      const dirname = modulePath.split('/').slice(0, -1).join('/')

      function define (callback) {
        callback(customRequire, module.exports, module)
      }

      if (customRequire.definitions.hasOwnProperty(modulePath)) {
        customRequire.cache[modulePath] = module
        customRequire.definitions[modulePath].apply(module.exports, [module.exports, module, modulePath, dirname, customRequire, define])
      } else {
        module.exports = require(modulePath)
        customRequire.cache[modulePath] = module
      }
    }
    return module.exports
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
    setGlobals: function (newGlobal, newProcess, newWindow, newDocument, newConsole, nodeRequire) {
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

      for (let key of Object.keys(console)) {
        newConsole[key] = console[key]
      }
      console = newConsole

      require = nodeRequire
    },
    translateSnapshotRow: function (row) {
      let low = 0
      let high = snapshotAuxiliaryData.snapshotSections.length - 1
      while (low <= high) {
        const mid = low + (high - low >> 1)
        const section = snapshotAuxiliaryData.snapshotSections[mid]
        if (row < section.startRow) {
          high = mid - 1
        } else if (row >= section.endRow) {
          low = mid + 1
        } else {
          return {
            relativePath: section.relativePath,
            row: row - section.startRow
          }
        }
      }

      return {relativePath: '<embedded>', row: row}
    }
  }
}

snapshotAuxiliaryData.snapshotSections = []
var snapshotResult = generateSnapshot()
