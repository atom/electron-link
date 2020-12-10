const assert = require('assert')
const path = require('path')
const recast = require('recast')
const astUtil = require('ast-util-plus')
const b = recast.types.builders
const resolve = require('resolve')
const acorn = require('recast/parsers/acorn')

const GLOBALS = new Set(['global', 'window', 'process', 'document', 'console'])
const NODE_CORE_MODULES = new Set([
  'assert', 'buffer', 'child_process', 'cluster', 'constants', 'crypto',
  'dgram', 'dns', 'domain', 'events', 'fs', 'http', 'https', 'module', 'net',
  'os', 'path', 'punycode', 'querystring', 'readline', 'repl', 'stream',
  'string_decoder', 'tls', 'tty', 'url', 'util', 'v8', 'vm', 'zlib'
])

module.exports = class FileRequireTransform {
  constructor (options) {
    this.options = options
  }

  apply () {
    let source = this.options.source
    if (this.options.filePath && path.extname(this.options.filePath) === '.json') {
      // Replace line separator and paragraph separator character (which aren't
      // supported inside javascript strings) with escape unicode sequences.
      source = "module.exports = " + source.replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
    }
    this.ast = recast.parse(source, {
      parser: {
        parse(source) {
          return acorn.parse(source, {
            ecmaVersion: 2020,
            sourceType: 'script'
          })
        }
      }
    })
    this.lazyRequireFunctionsByVariableName = new Map()
    this.replaceDeferredRequiresWithLazyFunctions()
    this.replaceReferencesToDeferredRequiresWithFunctionCalls()
    this.replaceReferencesToGlobalsWithFunctionCalls()
    return recast.print(this.ast).code
  }

  replaceDeferredRequiresWithLazyFunctions () {
    const self = this
    recast.types.visit(this.ast, {
      visitCallExpression: function (astPath) {
        if (isStaticRequire(astPath)) {
          const moduleName = astPath.node.arguments[0].value
          const absoluteModulePath = self.resolveModulePath(moduleName)
          if (absoluteModulePath) {
            let relativeModulePath = path.relative(self.options.baseDirPath, absoluteModulePath).replace(/\\/g, '/')
            if (!relativeModulePath.startsWith('.')) {
              relativeModulePath = './' + relativeModulePath
            }
            astPath.get('arguments', 0).replace(b.literal(relativeModulePath))
          }

          const deferRequire = NODE_CORE_MODULES.has(moduleName) || self.options.didFindRequire(moduleName, absoluteModulePath || moduleName)
          if (deferRequire && isTopLevelASTPath(astPath)) {
            self.replaceAssignmentOrDeclarationWithLazyFunction(astPath)
          }
        } else if (isStaticRequireResolve(astPath)) {
          const moduleName = astPath.node.arguments[0].value
          const absoluteModulePath = self.resolveModulePath(moduleName)
          if (absoluteModulePath) {
            let relativeModulePath = path.relative(self.options.baseDirPath, absoluteModulePath).replace(/\\/g, '/')
            if (!relativeModulePath.startsWith('.')) {
              relativeModulePath = './' + relativeModulePath
            }
            astPath.get('arguments', 0).replace(b.literal(relativeModulePath))
          }
        }
        this.traverse(astPath)
      }
    })

    let foundReferenceToLazyRequire = true
    while (foundReferenceToLazyRequire) {
      foundReferenceToLazyRequire = false
      recast.types.visit(this.ast, {
        visitIdentifier: function (astPath) {
          if (isTopLevelASTPath(astPath) && self.isReferenceToLazyRequire(astPath)) {
            astPath.replace(b.callExpression(b.identifier(self.lazyRequireFunctionsByVariableName.get(astPath.node.name)), []))
            self.replaceAssignmentOrDeclarationWithLazyFunction(astPath)
            foundReferenceToLazyRequire = true
            this.abort()
          } else {
            this.traverse(astPath)
          }
        }
      })
    }
  }

  replaceReferencesToDeferredRequiresWithFunctionCalls () {
    const self = this
    recast.types.visit(this.ast, {
      visitIdentifier: function (astPath) {
        if (!isTopLevelASTPath(astPath) && self.isReferenceToLazyRequire(astPath) && !isReferenceToShadowedVariable(astPath)) {
          astPath.replace(b.callExpression(b.identifier(self.lazyRequireFunctionsByVariableName.get(astPath.node.name)), []))
        }
        this.traverse(astPath)
      }
    })
  }

  replaceReferencesToGlobalsWithFunctionCalls () {
    recast.types.visit(this.ast, {
      visitIdentifier: function (astPath) {
        if (astUtil.isReference(astPath) && !isReferenceToShadowedVariable(astPath) && GLOBALS.has(astPath.node.name)) {
          astPath.replace(b.callExpression(b.identifier(`get_${astPath.node.name}`), []))
        }
        this.traverse(astPath)
      }
    })
  }

  replaceAssignmentOrDeclarationWithLazyFunction (astPath) {
    let parentPath = astPath.parent
    while (parentPath != null && parentPath.scope === astPath.scope) {
      const parentNode = parentPath.node
      if (parentNode.type === 'AssignmentExpression') {
        const lazyRequireFunctionName = `get_${parentNode.left.name}`

        let ifStatementPath = parentPath.parent
        while (ifStatementPath && ifStatementPath.node.type !== 'IfStatement') {
          ifStatementPath = ifStatementPath.parent
        }


        let assignmentLhs = parentNode.left
        while (assignmentLhs.type === 'MemberExpression') {
          assignmentLhs = assignmentLhs.object
        }
        assert.equal(assignmentLhs.type, 'Identifier')

        if (["module", "exports"].includes(assignmentLhs.name)) {
          console.warn(`##[warning] The reference to the module is replaced with the lazy function, but it is assigned to "module" or "exports". In some cases the bundle might not work, which you should fix manually: \n ${this.options.filePath} \n`);
          return // don't replace anything (module.exports = get_name)
        }

        // Ensure we're assigning to a variable declared in this scope.
        assert(
          astPath.scope.declares(assignmentLhs.name),
          `${this.options.filePath}\nAssigning a deferred module to a variable that was not declared in this scope is not supported!`
        )

        // Replace assignment with lazy function
        let replacement = null
        if (ifStatementPath) {
          if (!this.lazyRequireFunctionsByVariableName.has(parentNode.left.name)) {
            ifStatementPath.insertBefore(b.variableDeclaration(
              'let',
              [b.variableDeclarator(b.identifier(lazyRequireFunctionName), null)]
            ))
          }

          replacement = b.assignmentExpression('=', b.identifier(lazyRequireFunctionName), b.functionExpression(null, [], b.blockStatement([
            b.returnStatement(
              b.assignmentExpression('=', parentNode.left, b.logicalExpression('||', parentNode.left, parentNode.right))
            )
          ])))
        } else {
          replacement = b.functionDeclaration(b.identifier(lazyRequireFunctionName), [], b.blockStatement([
            b.returnStatement(
              b.assignmentExpression('=', parentNode.left, b.logicalExpression('||', parentNode.left, parentNode.right))
            )
          ]))
        }

        if (parentPath.parent.node.type === 'SequenceExpression') {
          const sequenceExpressionPath = parentPath.parent
          const expressionContainerPath = sequenceExpressionPath.parent
          if (sequenceExpressionPath.node.expressions.length === 1) {
            expressionContainerPath.replace(replacement)
          } else {
            expressionContainerPath.insertBefore(replacement)
            parentPath.replace()
          }
        } else {
          parentPath.replace(replacement)
        }

        this.lazyRequireFunctionsByVariableName.set(parentNode.left.name, lazyRequireFunctionName)
        return
      } else if (parentNode.type === 'VariableDeclarator') {
        // Replace variable declaration with lazy function
        const variableDeclarationPath = parentPath.parent
        const variableDeclarationNode = variableDeclarationPath.node
        if (variableDeclarationNode.kind === 'const') {
          variableDeclarationNode.kind = 'let'
        }

        if (parentNode.id.type === 'ObjectPattern') {
          parentPath.replace(b.variableDeclarator(parentNode.id, b.objectExpression([])))
          for (const property of parentNode.id.properties.slice().reverse()) {
            const lazyRequireFunctionName = `get_${property.key.name}`
            variableDeclarationPath.insertAfter(b.functionDeclaration(b.identifier(lazyRequireFunctionName), [], b.blockStatement([
              b.returnStatement(
                b.assignmentExpression('=', property.key, b.logicalExpression('||', property.key, b.memberExpression(parentNode.init, property.key)))
              )
            ])))
            this.lazyRequireFunctionsByVariableName.set(property.key.name, lazyRequireFunctionName)
          }
        } else {
          parentPath.replace(b.variableDeclarator(parentNode.id, null))
          const lazyRequireFunctionName = `get_${parentNode.id.name}`
          variableDeclarationPath.insertAfter(b.functionDeclaration(b.identifier(lazyRequireFunctionName), [], b.blockStatement([
            b.returnStatement(
              b.assignmentExpression('=', parentNode.id, b.logicalExpression('||', parentNode.id, parentNode.init))
            )
          ])))
          this.lazyRequireFunctionsByVariableName.set(parentNode.id.name, lazyRequireFunctionName)
        }

        return
      }
      parentPath = parentPath.parent
    }
    console.warn(`##[warning] The reference to the module is replaced with the lazy function, but it was not in an assignment expression or a variable declaration. In some cases the bundle might not work, which you should fix manually: \n ${this.options.filePath} `);
    return    // just call the reference it directly
  }

  isReferenceToLazyRequire (astPath) {
    const scope = astPath.scope
    const lazyRequireFunctionName = this.lazyRequireFunctionsByVariableName.get(astPath.node.name)
    if (lazyRequireFunctionName != null &&
        (scope.node.type !== 'FunctionDeclaration' || lazyRequireFunctionName !== astPath.scope.node.id.name) &&
        (scope.node.type !== 'FunctionExpression' || scope.path.parent.node.type !== 'AssignmentExpression' || lazyRequireFunctionName !== scope.path.parent.node.left.name) &&
        (astPath.parent.node.type !== 'Property' || astPath.parent.parent.node.type !== 'ObjectPattern') ) {
      if (astPath.parent.node.type === 'AssignmentExpression') {
        return astPath.name === "right" && astUtil.isReference(astPath) // e.g module.exports = a_reference;
      } else {
        return astUtil.isReference(astPath)
      }

    }
  }

  resolveModulePath (moduleName) {
    try {
      const absolutePath = resolve.sync(moduleName, {basedir: path.dirname(this.options.filePath), extensions: ['.js', '.json']})
      const isCoreNodeModule = absolutePath.indexOf(path.sep) === -1
      return isCoreNodeModule ? null : absolutePath
    } catch (e) {
      return null
    }
  }
}

function isReferenceToShadowedVariable (astPath) {
  const referenceName = astPath.node.name
  let scope = astPath.scope
  let foundDeclaration = GLOBALS.has(referenceName)
  while (scope) {
    if (scope.declares(referenceName)) {
      if (foundDeclaration) {
        return true
      } else {
        foundDeclaration = true
      }
    }
    scope = scope.parent
  }
  return false
}

function isStaticRequire (astPath) {
  const node = astPath.node
  return (
    node.callee.name === 'require' &&
    node.arguments.length === 1 &&
    node.arguments[0].type === 'Literal'
  )
}

function isStaticRequireResolve (astPath) {
  const node = astPath.node
  return (
    node.callee.type === 'MemberExpression' &&
    node.callee.object.name === 'require' &&
    node.callee.property.name === 'resolve' &&
    node.arguments.length === 1 &&
    node.arguments[0].type === 'Literal'
  )
}

function isTopLevelASTPath (astPath) {
  if (astPath.scope.isGlobal) {
    return true
  } else if (astPath.scope.depth === 1) {
    while (astPath) {
      const node = astPath.node
      if (node.type === 'FunctionExpression') {
        const parentNode = astPath.parent.node
        const grandparentNode = astPath.parent.parent.node
        const parentIsCallExpression = parentNode.type === 'CallExpression' && parentNode.arguments.indexOf(node) === -1
        const grandparentIsCallExpression = grandparentNode.type === 'CallExpression'
        if (parentIsCallExpression || grandparentIsCallExpression) {
          return true
        }
      }
      astPath = astPath.parent
    }
    return false
  } else {
    return false
  }
}
