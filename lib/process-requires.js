'use strict'

const assert = require('assert')
const path = require('path')
const recast = require('recast')
const b = recast.types.builders
const resolve = require('resolve')

module.exports = function (options) {
  const ast = recast.parse(options.source)
  const programHasClosureWrapper =
    ast.program.body.length === 1 &&
    ast.program.body[0].type === 'ExpressionStatement' &&
    ast.program.body[0].expression.type === 'CallExpression' &&
    ast.program.body[0].expression.arguments[0].type === 'ThisExpression' &&
    ast.program.body[0].expression.callee.object.type === 'FunctionExpression'
  const lazyRequireFunctionsByVariableName = new Map()

  recast.types.visit(ast, {
    visitCallExpression: function (astPath) {
      if (isStaticRequire(astPath)) {
        const moduleName = astPath.node.arguments[0].value
        const absoluteModulePath = resolveModulePath(moduleName)
        if (absoluteModulePath) {
          const relativeModulePath = './' + path.relative(options.baseDirPath, absoluteModulePath)
          astPath.get('arguments', 0).replace(b.literal(relativeModulePath))
        }

        if (isTopLevelASTPath(astPath) && options.didFindRequire(absoluteModulePath || moduleName)) {
          replaceAssignmentOrDeclarationWithLazyFunction(astPath)
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
    return astPath.scope.isGlobal || (programHasClosureWrapper && astPath.scope.depth === 1)
  }

  function isReferenceToLazyRequire (astPath) {
    const node = astPath.node
    const parent = astPath.parent.node
    const lazyRequireFunctionName = lazyRequireFunctionsByVariableName.get(node.name)
    return (
      lazyRequireFunctionName != null &&
      (astPath.scope.node.type !== 'FunctionDeclaration' || lazyRequireFunctionName !== astPath.scope.node.id.name) &&
      isReference(node, parent)
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
        lazyRequireFunctionsByVariableName.set(parentNode.left.name, lazyRequireFunctionName)
        parentPath.replace(b.functionDeclaration(b.identifier(lazyRequireFunctionName), [], b.blockStatement([
          b.returnStatement(
            b.assignmentExpression('=', parentNode.left, b.logicalExpression('||', parentNode.left, parentNode.right))
          )
        ])))
        return
      } else if (parentNode.type === 'VariableDeclarator') {
        // Replace variable declaration with lazy function
        const lazyRequireFunctionName = `get_${parentNode.id.name}`
        const variableDeclarationPath = parentPath.parent
        const variableDeclarationNode = variableDeclarationPath.node
        if (variableDeclarationNode.kind === 'const') {
          variableDeclarationNode.kind = 'let'
        }
        lazyRequireFunctionsByVariableName.set(parentNode.id.name, lazyRequireFunctionName)
        parentPath.replace(b.variableDeclarator(parentNode.id, null))
        variableDeclarationPath.insertAfter(b.functionDeclaration(b.identifier(lazyRequireFunctionName), [], b.blockStatement([
          b.returnStatement(
            b.assignmentExpression('=', parentNode.id, b.logicalExpression('||', parentNode.id, parentNode.init))
          )
        ])))
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
      return resolve.sync(moduleName, {basedir: path.dirname(options.filePath)})
    } catch (e) {
      return null
    }
  }
}

function isReferenceToShadowedVariable (astPath) {
  const referenceName = astPath.node.name
  let scope = astPath.scope
  let foundDeclaration = false
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

function isReference (node, parent) {
  switch (parent.type) {
    // yes: object::NODE
    // yes: NODE::callee
    case "BindExpression":
      return parent.object === node || parent.callee === node;

    // yes: PARENT[NODE]
    // yes: NODE.child
    // no: parent.NODE
    case "MemberExpression":
    case "JSXMemberExpression":
      if (parent.property === node && parent.computed) {
        return true;
      } else if (parent.object === node) {
        return true;
      } else {
        return false;
      }

    // no: new.NODE
    // no: NODE.target
    case "MetaProperty":
      return false;

    // yes: { [NODE]: "" }
    // yes: { NODE }
    // no: { NODE: "" }
    case "ObjectProperty":
      if (parent.key === node) {
        return parent.computed;
      }

    // no: let NODE = init;
    // yes: let id = NODE;
    case "VariableDeclarator":
      return parent.id !== node;

    // no: function NODE() {}
    // no: function foo(NODE) {}
    case "ArrowFunctionExpression":
    case "FunctionDeclaration":
    case "FunctionExpression":
      for (let param of parent.params) {
        if (param === node) return false;
      }

      return parent.id !== node;

    // no: export { foo as NODE };
    // yes: export { NODE as foo };
    // no: export { NODE as foo } from "foo";
    case "ExportSpecifier":
      if (parent.source) {
        return false;
      } else {
        return parent.local === node;
      }

    // no: export NODE from "foo";
    // no: export * as NODE from "foo";
    case "ExportNamespaceSpecifier":
    case "ExportDefaultSpecifier":
      return false;

    // no: <div NODE="foo" />
    case "JSXAttribute":
      return parent.name !== node;

    // no: class { NODE = value; }
    // yes: class { [NODE] = value; }
    // yes: class { key = NODE; }
    case "ClassProperty":
      if (parent.key === node) {
        return parent.computed;
      } else {
        return parent.value === node;
      }

    // no: import NODE from "foo";
    // no: import * as NODE from "foo";
    // no: import { NODE as foo } from "foo";
    // no: import { foo as NODE } from "foo";
    // no: import NODE from "bar";
    case "ImportDefaultSpecifier":
    case "ImportNamespaceSpecifier":
    case "ImportSpecifier":
      return false;

    // no: class NODE {}
    case "ClassDeclaration":
    case "ClassExpression":
      return parent.id !== node;

    // yes: class { [NODE]() {} }
    case "ClassMethod":
    case "ObjectMethod":
      return parent.key === node && parent.computed;

    // no: NODE: for (;;) {}
    case "LabeledStatement":
      return false;

    // no: try {} catch (NODE) {}
    case "CatchClause":
      return parent.param !== node;

    // no: function foo(...NODE) {}
    case "RestElement":
      return false;

    // yes: left = NODE;
    // no: NODE = right;
    case "AssignmentExpression":
      return parent.right === node;

    // no: [NODE = foo] = [];
    // yes: [foo = NODE] = [];
    case "AssignmentPattern":
      return parent.right === node;

    // no: [NODE] = [];
    // no: ({ NODE }) = [];
    case "ObjectPattern":
    case "ArrayPattern":
      return false;
  }

  return true;
}

function isStaticRequire (astPath) {
  const node = astPath.node
  return (
    node.callee.name === 'require' &&
    node.arguments.length === 1 &&
    node.arguments[0].type === 'Literal'
  )
}
