'use strict'

const fs = require('fs')
const path = require('path')
const FileRequireTransform = require('./file-require-transform')
const indentString = require('indent-string')
const {SourceMapGenerator} = require('source-map')

module.exports = async function (cache, options) {
  // Phase 1: Starting at the main module, traverse all requires, transforming
  // all module references to paths relative to the base directory path and
  // collecting abstract syntax trees for use in generating the script in
  // phase 2.
  const moduleASTs = {}
  const requiredModulePaths = [options.mainPath]
  const includedFilePaths = new Set(requiredModulePaths)

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
          if (options.shouldExcludeModule({requiringModulePath: filePath, requiredModulePath: resolvedPath})) {
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
        try {
          transformedSource = indentString(transform.apply(), 2)
        } catch (e) {
          console.error(`Unable to transform source code for module ${filePath}.`)
          if (e.index) {
            const before = source.slice(e.index - 100, e.index)
            const after = source.slice(e.index, e.index + 100)
            console.error(`\n${before}==>${after}\n`)
          }
          throw e
        }
        await cache.put({filePath, original: source, transformed: transformedSource, requires: foundRequires})
      }

      moduleASTs[relativeFilePath] = `function (exports, module, __filename, __dirname, require, define) {\n${transformedSource}\n}`

      const resolvedRequirePaths = foundRequires.map(r => r.resolvedPath)
      for (let i = 0; i < foundRequires.length; i++) {
        const {resolvedPath} = foundRequires[i]
        requiredModulePaths.push(resolvedPath)
        includedFilePaths.add(resolvedPath)
      }
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

  const auxiliaryData = JSON.stringify(options.auxiliaryData || {})
  const auxiliaryDataAssignment = 'var snapshotAuxiliaryData = {}'
  const auxiliaryDataAssignmentStartIndex = snapshotScript.indexOf(auxiliaryDataAssignment)
  const auxiliaryDataAssignmentEndIndex = auxiliaryDataAssignmentStartIndex + auxiliaryDataAssignment.length
  snapshotScript =
    snapshotScript.slice(0, auxiliaryDataAssignmentStartIndex) +
    `var snapshotAuxiliaryData = ${auxiliaryData};` +
    snapshotScript.slice(auxiliaryDataAssignmentEndIndex)

  // Replace `require.definitions = {}` with an assignment of the actual definitions
  // of all the modules.
  const definitionsAssignment = 'customRequire.definitions = {}'
  const definitionsAssignmentStartIndex = snapshotScript.indexOf(definitionsAssignment)
  const definitionsAssignmentEndIndex = definitionsAssignmentStartIndex + definitionsAssignment.length
  const sections = []
  let sectionStartRow = getLineCount(snapshotScript.slice(0, definitionsAssignmentStartIndex)) + 1
  let definitions = ''
  const moduleFilePaths = Object.keys(moduleASTs)
  for (let i = 0; i < moduleFilePaths.length; i++) {
    const relativePath = moduleFilePaths[i]
    const source = moduleASTs[relativePath]
    const lineCount = getLineCount(source)
    sections.push({relativePath, startRow: sectionStartRow, endRow: (sectionStartRow + lineCount) - 2})
    definitions += indentString(`${JSON.stringify(relativePath)}: ${source}`, 4) + ',\n'
    sectionStartRow += lineCount
  }

  snapshotScript =
    snapshotScript.slice(0, definitionsAssignmentStartIndex) +
    `customRequire.definitions = {\n${definitions}\n  };` +
    snapshotScript.slice(definitionsAssignmentEndIndex)

  // The following code to generate metadata to map line numbers in the snapshot
  // must remain at the end of this function to ensure all the embedded code is
  // accounted for.
  const sectionsAssignment = 'snapshotAuxiliaryData.snapshotSections = []'
  const sectionsAssignmentStartIndex = snapshotScript.indexOf(sectionsAssignment)
  const sectionsAssignmentEndIndex = sectionsAssignmentStartIndex + sectionsAssignment.length
  snapshotScript =
    snapshotScript.slice(0, sectionsAssignmentStartIndex) +
    `snapshotAuxiliaryData.snapshotSections = ${JSON.stringify(sections)}` +
    snapshotScript.slice(sectionsAssignmentEndIndex)

  return {snapshotScript, includedFilePaths}
}

function getLineCount (text) {
  let lineCount = 1
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') lineCount++
  }
  return lineCount
}
