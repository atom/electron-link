'use strict'

const fs = require('fs')
const path = require('path')
const FileRequireTransform = require('./file-require-transform')
const indentString = require('indent-string')
const {SourceMapGenerator} = require('source-map')

const FUNCTION_HEADER = 'function (exports, module, __filename, __dirname, require, define)'

module.exports = async function (cache, options) {
  // Phase 1: Starting at the main module, traverse all requires, transforming
  // all module references to paths relative to the base directory path and
  // collecting abstract syntax trees for use in generating the script in
  // phase 2.
  const moduleASTs = {}
  const requiredModulePaths = [options.mainPath]
  while (requiredModulePaths.length > 0) {
    const filePath = requiredModulePaths.shift()
    let relativeFilePath = path.relative(options.baseDirPath, filePath).replace(/\\/g, '/')
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

      const cachedTransform = await cache.get({filePath, content: source})
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
        await cache.put({filePath, original: source, transformed: transformedSource, requires: foundRequires})
      }

      moduleASTs[relativeFilePath] = `${FUNCTION_HEADER} {\n${transformedSource}\n}`
      requiredModulePaths.push(...foundRequires.map(r => r.resolvedPath))
    }
  }

  await cache.deleteUnusedEntries()

  // Phase 2: Now use the data we gathered during phase 1 to build a snapshot
  // script based on `./blueprint.js`.
  let snapshotScript = fs.readFileSync(path.join(__dirname, 'blueprint.js'), 'utf8')

  // Replace `require(main)` with a require of the relativized main module path.
  let relativeFilePath = path.relative(options.baseDirPath, options.mainPath).replace(/\\/g, '/')
  if (!relativeFilePath.startsWith('.')) {
    relativeFilePath = './' + relativeFilePath
  }
  snapshotScript = snapshotScript.replace('mainModuleRequirePath', JSON.stringify(relativeFilePath))

  // Assign the current platform to `process.platform` so that it can be used
  // even while creating the snapshot.
  snapshotScript = snapshotScript.replace('processPlatform', process.platform)

  // Assign the current platform's path separator so that custom require works
  // correctly on both Windows and Unix systems.
  snapshotScript = snapshotScript.replace('const pathSeparator = null', `const pathSeparator = ${JSON.stringify(path.sep)}`)

  // Replace `require.definitions = {}` with an assignment of the actual definitions
  // of all the modules.
  let definitions = ''
  const moduleFilePaths = Object.keys(moduleASTs)
  for (let i = 0; i < moduleFilePaths.length - 1; i++) {
    const filePath = moduleFilePaths[i]
    const source = moduleASTs[filePath]
    definitions += indentString(`${JSON.stringify(filePath)}: ${source}`, ' ', 4) + ',\n'
  }
  if (moduleFilePaths.length > 0) {
    const filePath = moduleFilePaths[moduleFilePaths.length - 1]
    const source = moduleASTs[filePath]
    definitions += indentString(`${JSON.stringify(filePath)}: ${source}`, ' ', 4)
  }

  const definitionsAssignment = 'customRequire.definitions = {}'
  const definitionsAssignmentStartIndex = snapshotScript.indexOf(definitionsAssignment)
  const definitionsAssignmentEndIndex = definitionsAssignmentStartIndex + definitionsAssignment.length
  snapshotScript =
    snapshotScript.slice(0, definitionsAssignmentStartIndex) +
    `customRequire.definitions = {\n${definitions}\n  };` +
    snapshotScript.slice(definitionsAssignmentEndIndex)

  const auxiliaryData = JSON.stringify(options.auxiliaryData || {})
  const auxiliaryDataAssignment = 'var snapshotAuxiliaryData = {}'
  const auxiliaryDataAssignmentStartIndex = snapshotScript.indexOf(auxiliaryDataAssignment)
  const auxiliaryDataAssignmentEndIndex = auxiliaryDataAssignmentStartIndex + auxiliaryDataAssignment.length
  snapshotScript =
    snapshotScript.slice(0, auxiliaryDataAssignmentStartIndex) +
    `var snapshotAuxiliaryData = ${auxiliaryData};` +
    snapshotScript.slice(auxiliaryDataAssignmentEndIndex)

  // Generate source maps as the last step of this routine.
  const sourceMapGenerator = new SourceMapGenerator()
  const snapshotScriptLines = snapshotScript.split('\n')
  let insideCustomRequireDefinitions = false
  let currentFileName = null
  let currentFileRelativeLineNumber = null

  for (let i = 0; i < snapshotScriptLines.length; i++) {
    const snapshotAbsoluteLineNumber = i + 1
    const snapshotContentLine = snapshotScriptLines[i]
    if (snapshotContentLine === '  customRequire.definitions = {') {
      insideCustomRequireDefinitions = true
      sourceMapGenerator.addMapping({
        source: '<embedded>',
        original: {line: snapshotAbsoluteLineNumber, column: 0},
        generated: {line: snapshotAbsoluteLineNumber, column: 0}
      })
    } else if (insideCustomRequireDefinitions) {
      if (snapshotContentLine === '  };') {
        insideCustomRequireDefinitions = false
        sourceMapGenerator.addMapping({
          source: '<embedded>',
          original: {line: snapshotAbsoluteLineNumber, column: 0},
          generated: {line: snapshotAbsoluteLineNumber, column: 0}
        })
      } else if (snapshotContentLine.startsWith('    "')) {
        currentFileName = snapshotContentLine.slice(5, -(FUNCTION_HEADER.length + 5))
        currentFileRelativeLineNumber = 1
        sourceMapGenerator.addMapping({
          source: '<embedded>',
          original: {line: snapshotAbsoluteLineNumber, column: 0},
          generated: {line: snapshotAbsoluteLineNumber, column: 0}
        })
      } else if (currentFileName) {
        sourceMapGenerator.addMapping({
          source: currentFileName,
          original: {line: currentFileRelativeLineNumber++, column: 0},
          generated: {line: snapshotAbsoluteLineNumber, column: 0}
        })

        if (snapshotContentLine.startsWith('    }')) {
          currentFileName = null
          currentFileRelativeLineNumber = null
        }
      }
    } else {
      sourceMapGenerator.addMapping({
        source: '<embedded>',
        original: {line: snapshotAbsoluteLineNumber, column: 0},
        generated: {line: snapshotAbsoluteLineNumber, column: 0}
      })
    }
  }

  const sourceMapAssignment = 'sourceMap: {}'
  const sourceMapAssignmentStartIndex = snapshotScript.indexOf(sourceMapAssignment)
  const sourceMapAssignmentEndIndex = sourceMapAssignmentStartIndex + sourceMapAssignment.length
  snapshotScript =
    snapshotScript.slice(0, sourceMapAssignmentStartIndex) +
    `sourceMap: ${sourceMapGenerator.toString()}` +
    snapshotScript.slice(sourceMapAssignmentEndIndex)

  return snapshotScript
}
