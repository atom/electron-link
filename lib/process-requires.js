'use strict'

const assert = require('assert')
const path = require('path')
const recast = require('recast')
const astUtil = require('ast-util')
const b = recast.types.builders
const resolve = require('resolve')

const GLOBALS = new Set(['global', 'window', 'process'])

module.exports = function (options) {
  let source = options.source
  if (options.filePath && path.extname(options.filePath) === '.json') {
    // Replace line separator and paragraph separator character (which aren't
    // supported inside javascript strings) with escape unicode sequences.
    source = "module.exports = " + source.replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
  }
  const ast = recast.parse(source)
  const lazyRequireFunctionsByVariableName = new Map()

  recast.types.visit(ast, {
    visitIdentifier: function (astPath) {
      if (astUtil.isReference(astPath) && !isReferenceToShadowedVariable(astPath) && GLOBALS.has(astPath.node.name)) {
        astPath.replace(b.callExpression(b.identifier(`get_${astPath.node.name}`), []))
      }
      this.traverse(astPath)
    }
  })

  recast.types.visit(ast, {
    visitCallExpression: function (astPath) {
      if (isStaticRequire(astPath)) {
        const moduleName = astPath.node.arguments[0].value
        const absoluteModulePath = resolveModulePath(moduleName)
        if (absoluteModulePath) {
          const relativeModulePath = './' + path.relative(options.baseDirPath, absoluteModulePath)
          astPath.get('arguments', 0).replace(b.literal(relativeModulePath))
        }

        if (options.didFindRequire(absoluteModulePath || moduleName) && isTopLevelASTPath(astPath)) {
          replaceAssignmentOrDeclarationWithLazyFunction(astPath)
        }
      } else if (isStaticRequireResolve(astPath)) {
        const moduleName = astPath.node.arguments[0].value
        const absoluteModulePath = resolveModulePath(moduleName)
        if (absoluteModulePath) {
          const relativeModulePath = './' + path.relative(options.baseDirPath, absoluteModulePath)
          astPath.get('arguments', 0).replace(b.literal(relativeModulePath))
        }
      }
      this.traverse(astPath);
    }
  })

  recast.types.visit(ast, {
    visitIdentifier: function (astPath) {
      if (isTopLevelASTPath(astPath) && isReferenceToLazyRequire(astPath)) {
        astPath.replace(b.callExpression(b.identifier(lazyRequireFunctionsByVariableName.get(astPath.node.name)), []))
        replaceAssignmentOrDeclarationWithLazyFunction(astPath)
      }
      this.traverse(astPath)
    }
  })

  recast.types.visit(ast, {
    visitIdentifier: function (astPath) {
      if (!isTopLevelASTPath(astPath) && isReferenceToLazyRequire(astPath) && !isReferenceToShadowedVariable(astPath)) {
        astPath.replace(b.callExpression(b.identifier(lazyRequireFunctionsByVariableName.get(astPath.node.name)), []))
      }
      this.traverse(astPath)
    }
  })

  return ast

  function isTopLevelASTPath (astPath) {
    if (astPath.scope.isGlobal) {
      return true
    } else if (astPath.scope.depth === 1) {
      while (astPath) {
        const node = astPath.node
        if (node.type === 'FunctionExpression') {
          const parentNode = astPath.parent.node
          const grandparentNode = astPath.parent.parent.node
          const parentIsCallExpression = parentNode.type === 'CallExpression' && parentNode.callee.name !== '_asyncToGenerator'
          const grandparentIsCallExpression = grandparentNode.type === 'CallExpression' && grandparentNode.callee.name !== '_asyncToGenerator'
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

  function isReferenceToLazyRequire (astPath) {
    const node = astPath.node
    const parent = astPath.parent.node
    const lazyRequireFunctionName = lazyRequireFunctionsByVariableName.get(node.name)
    return (
      lazyRequireFunctionName != null &&
      (astPath.scope.node.type !== 'FunctionDeclaration' || lazyRequireFunctionName !== astPath.scope.node.id.name) &&
      astUtil.isReference(astPath)
    )
  }

  function replaceAssignmentOrDeclarationWithLazyFunction (astPath) {
    let parentPath = astPath.parent
    while (parentPath != null && parentPath.scope === astPath.scope) {
      const parentNode = parentPath.node
      if (parentNode.type === 'AssignmentExpression') {
        // Ensure we're assigning to a variable declared in this scope.
        let assignmentLhs = parentNode.left
        while (assignmentLhs.type === 'MemberExpression') {
          assignmentLhs = assignmentLhs.object
        }
        assert.equal(assignmentLhs.type, 'Identifier')
        assert(
          astPath.scope.declares(assignmentLhs.name),
          `${options.filePath}\nAssigning a deferred module to a variable that was not declared in this scope is not supported!`
        )

        // Replace assignment with lazy function
        const lazyRequireFunctionName = `get_${parentNode.left.name}`
        const functionDeclaration = b.functionDeclaration(b.identifier(lazyRequireFunctionName), [], b.blockStatement([
          b.returnStatement(
            b.assignmentExpression('=', parentNode.left, b.logicalExpression('||', parentNode.left, parentNode.right))
          )
        ]))
        if (parentPath.parent.node.type === 'SequenceExpression') {
          const sequenceExpressionPath = parentPath.parent
          const expressionContainerPath = sequenceExpressionPath.parent
          if (sequenceExpressionPath.node.expressions.length === 1) {
            expressionContainerPath.replace(functionDeclaration)
          } else {
            expressionContainerPath.insertBefore(functionDeclaration)
            parentPath.replace()
          }
        } else {
          parentPath.replace(functionDeclaration)
        }
        lazyRequireFunctionsByVariableName.set(parentNode.left.name, lazyRequireFunctionName)
        return
      } else if (parentNode.type === 'VariableDeclarator') {
        // Replace variable declaration with lazy function
        const lazyRequireFunctionName = `get_${parentNode.id.name}`
        const variableDeclarationPath = parentPath.parent
        const variableDeclarationNode = variableDeclarationPath.node
        if (variableDeclarationNode.kind === 'const') {
          variableDeclarationNode.kind = 'let'
        }
        parentPath.replace(b.variableDeclarator(parentNode.id, null))
        variableDeclarationPath.insertAfter(b.functionDeclaration(b.identifier(lazyRequireFunctionName), [], b.blockStatement([
          b.returnStatement(
            b.assignmentExpression('=', parentNode.id, b.logicalExpression('||', parentNode.id, parentNode.init))
          )
        ])))
        lazyRequireFunctionsByVariableName.set(parentNode.id.name, lazyRequireFunctionName)
        return
      }
      parentPath = parentPath.parent
    }

    throw new Error(
      `${options.filePath}\n` +
      `Cannot replace with lazy function because the supplied node does not belong to an assignment expression or a variable declaration!`
    )
  }

  function resolveModulePath (moduleName) {
    try {
      const absolutePath = resolve.sync(moduleName, {basedir: path.dirname(options.filePath), extensions: ['.js', '.json']})
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
