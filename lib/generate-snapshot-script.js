'use strict'

const fs = require('fs')
const path = require('path')
const recast = require('recast')
const b = recast.types.builders
const processRequires = require('./process-requires')

module.exports = function (options) {
  // Phase 1: Starting at the main module, traverse all requires, transforming
  // all module references to paths relative to the base directory path and
  // collecting abstract syntax trees for use in generating the script in
  // phase 2.
  const moduleASTs = {}
  const requiredModulePaths = [options.mainPath]
  while (requiredModulePaths.length > 0) {
    const filePath = requiredModulePaths.shift()
    const relativeFilePath = './' + path.relative(options.baseDirPath, filePath)
    if (!moduleASTs[relativeFilePath]) {
      const source = fs.readFileSync(filePath, 'utf8')
      const ast = processRequires({
        filePath,
        source,
        baseDirPath: options.baseDirPath,
        didFindRequire: (modulePath) => {
          if (options.shouldExcludeModule(modulePath)) {
            return true
          } else {
            requiredModulePaths.push(modulePath)
            return false
          }
        }
      })
      moduleASTs[relativeFilePath] = b.functionExpression(
        null,
        [b.identifier('exports'), b.identifier('module'), b.identifier('__filename'), b.identifier('__dirname')],
        b.blockStatement(ast.program.body)
      )
    }
  }

  // Phase 2: Now use the data we gathered during phase 1 to build a snapshot
  // script based on `./blueprint.js`.
  const blueprintAST = recast.parse(fs.readFileSync(path.join(__dirname, 'blueprint.js')))

  recast.types.visit(blueprintAST, {
    // Replace `require.definitions = {}` with an assignment of the actual definitions
    // of all the modules.
    visitAssignmentExpression: function (astPath) {
      const node = astPath.node
      if (node.left.type === 'MemberExpression' && node.left.property.name === 'definitions') {
        const definitions = b.objectExpression(
          Object.keys(moduleASTs).map(relativeFilePath =>
            b.property('init', b.literal(relativeFilePath), moduleASTs[relativeFilePath])
          )
        )
        astPath.get('right').replace(definitions)
      }
      this.traverse(astPath);
    },

    // Replace `require(main)` with a require of the relativized main module path.
    visitIdentifier: function (astPath) {
      if (astPath.node.name === 'main') {
        astPath.replace(b.literal('./' + path.relative(options.baseDirPath, options.mainPath)))
      }
      this.traverse(astPath);
    }
  })

  return recast.print(blueprintAST).code
}
