'use strict'

const fs = require('fs')
const path = require('path')
const FileRequireTransform = require('./file-require-transform')
const indentString = require('indent-string')

module.exports = async function (cache, options) {
  // Phase 1: Starting at the main module, traverse all requires, transforming
  // all module references to paths relative to the base directory path and
  // collecting abstract syntax trees for use in generating the script in
  // phase 2.
  const moduleASTs = {}
  const requiredModulePaths = [options.mainPath]
  while (requiredModulePaths.length > 0) {
    const filePath = requiredModulePaths.shift()
    let relativeFilePath = path.relative(options.baseDirPath, filePath)
    if (!relativeFilePath.startsWith('.')) {
      relativeFilePath = './' + relativeFilePath
    }
    if (!moduleASTs[relativeFilePath]) {
      const source = fs.readFileSync(filePath, 'utf8')
      let foundRequires = []
      const transform = new FileRequireTransform({
        filePath,
        source,
        baseDirPath: options.baseDirPath,
        didFindRequire: (unresolvedPath, resolvedPath) => {
          if (options.shouldExcludeModule(resolvedPath)) {
            return true
          } else {
            foundRequires.push({unresolvedPath, resolvedPath})
            return false
          }
        }
      })

      const cachedTransform = await cache.get(source)
      const useCachedTransform =
        cachedTransform ?
        cachedTransform.requires.every(r => (transform.resolveModulePath(r.unresolvedPath) || r.unresolvedPath) === r.resolvedPath) :
        false

      let transformedSource, requires
      if (useCachedTransform) {
        transformedSource = cachedTransform.source
        foundRequires = cachedTransform.requires
      } else {
        transformedSource = indentString(transform.apply(), ' ', 2)
        await cache.put({original: source, transformed: transformedSource, requires: foundRequires})
      }

      moduleASTs[relativeFilePath] = `function (exports, module, __filename, __dirname, require, define) {\n${transformedSource}\n}`
      requiredModulePaths.push(...foundRequires.map(r => r.resolvedPath))
    }
  }

  // Phase 2: Now use the data we gathered during phase 1 to build a snapshot
  // script based on `./blueprint.js`.
  let snapshotContent = fs.readFileSync(path.join(__dirname, 'blueprint.js'), 'utf8')

  // Replace `require(main)` with a require of the relativized main module path.
  let relativeFilePath = path.relative(options.baseDirPath, options.mainPath)
  if (!relativeFilePath.startsWith('.')) {
    relativeFilePath = './' + relativeFilePath
  }
  snapshotContent = snapshotContent.replace('mainModuleRequirePath', `"${relativeFilePath}"`)

  // Replace `require.definitions = {}` with an assignment of the actual definitions
  // of all the modules.
  let definitions = ''
  const moduleFilePaths = Object.keys(moduleASTs)
  for (let i = 0; i < moduleFilePaths.length - 1; i++) {
    const filePath = moduleFilePaths[i]
    const source = moduleASTs[filePath]
    definitions += indentString(`"${filePath}": ${source}`, ' ', 4) + ',\n'
  }
  if (moduleFilePaths.length > 0) {
    const filePath = moduleFilePaths[moduleFilePaths.length - 1]
    const source = moduleASTs[filePath]
    definitions += indentString(`"${filePath}": ${source}`, ' ', 4)
  }

  const definitionsAssignment = 'customRequire.definitions = {}'
  const definitionsAssignmentStartIndex = snapshotContent.indexOf(definitionsAssignment)
  const definitionsAssignmentEndIndex = definitionsAssignmentStartIndex + definitionsAssignment.length
  snapshotContent =
    snapshotContent.slice(0, definitionsAssignmentStartIndex) +
    `customRequire.definitions = {\n${definitions}\n  }` +
    snapshotContent.slice(definitionsAssignmentEndIndex)

  return snapshotContent
}
