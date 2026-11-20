#!/usr/bin/env node
// McCabe cyclomatic complexity per file, computed from the TypeScript AST.
//
// Decision points counted (standard McCabe):
//   if / ternary / && / || / ?? / case (non-default) / for / for-in / for-of /
//   while / do-while / catch
// Each function-like node starts a new region with base complexity 1; the module
// body itself is one region. The file total is the sum of all regions.
//
// Usage: node mccabe.mjs <tsconfig-free-ts-file> [more files...]
// Output: JSON on stdout.

import ts from 'typescript'
import {readFileSync} from 'node:fs'

const FUNCTION_LIKE = new Set([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
  ts.SyntaxKind.Constructor,
])

const DECISION = new Set([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ConditionalExpression,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.CatchClause,
])

const LOGICAL = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
])

function analyze(filePath) {
  const source = ts.createSourceFile(
    filePath,
    readFileSync(filePath, 'utf8'),
    ts.ScriptTarget.ESNext,
    true,
    filePath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )

  // regions[0] is the module body; each function-like node appends a region.
  const regions = [{name: '<module>', line: 1, complexity: 1}]

  function walk(node, regionIndex) {
    let nextRegion = regionIndex
    if (FUNCTION_LIKE.has(node.kind)) {
      const {line} = source.getLineAndCharacterOfPosition(node.getStart(source))
      regions.push({name: describe(node), line: line + 1, complexity: 1})
      nextRegion = regions.length - 1
    } else if (DECISION.has(node.kind)) {
      regions[regionIndex].complexity += 1
    } else if (ts.isBinaryExpression(node) && LOGICAL.has(node.operatorToken.kind)) {
      regions[regionIndex].complexity += 1
    } else if (ts.isCaseClause(node)) {
      regions[regionIndex].complexity += 1
    }
    ts.forEachChild(node, (child) => walk(child, nextRegion))
  }

  function describe(node) {
    if (node.name && ts.isIdentifier(node.name)) return node.name.text
    const parent = node.parent
    if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) return parent.name.text
    if (parent && ts.isPropertyAssignment(parent)) return parent.name.getText(source)
    return '<anonymous>'
  }

  ts.forEachChild(source, (child) => walk(child, 0))

  const total = regions.reduce((sum, region) => sum + region.complexity, 0)
  const functionRegions = regions.slice(1)
  return {
    file: filePath,
    lines: source.getLineStarts().length,
    totalComplexity: total,
    regions: regions.length,
    maxRegionComplexity: Math.max(...regions.map((r) => r.complexity)),
    meanRegionComplexity: Number((total / regions.length).toFixed(2)),
    regionsOverFive: functionRegions.filter((r) => r.complexity > 5).length,
    worst: [...functionRegions].sort((a, b) => b.complexity - a.complexity).slice(0, 8),
  }
}

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('usage: node mccabe.mjs <file.ts> [...]')
  process.exit(1)
}
console.log(JSON.stringify(files.map(analyze), null, 2))
