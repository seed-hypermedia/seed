'use strict'
// GHSA-vfj7-8cjw-p6xm: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm
// BRACES_PACKAGE supports proving this exact regression against the unpatched package.
const assert = require('node:assert/strict')
const {test} = require('node:test')
const {createRequire} = require('node:module')
// Resolve the real transitive dependency used by the workspace's code tooling.
const toolingRequire = createRequire(require.resolve('jscodeshift'))
const micromatchRequire = createRequire(toolingRequire.resolve('micromatch'))
const braces = require(process.env.BRACES_PACKAGE || micromatchRequire.resolve('braces'))
const nested = (n, open = '{', close = '}') => open.repeat(n) + 'a,b' + close.repeat(n)
const bounded = (error) => error instanceof SyntaxError && /nesting.*100/.test(error.message)
const entrypoints = {
  default: (input) => braces(input),
  create: (input) => braces.create(input),
  parse: (input) => braces.parse(input),
  compile: (input) => braces.compile(input),
  expand: (input) => braces.expand(input),
  stringify: (input) => braces.stringify(input),
}
for (const [name, run] of Object.entries(entrypoints)) {
  test(`${name} bounds deeply nested braces, parentheses, mixed and unfinished input`, () => {
    for (const pattern of [nested(4500), nested(4500, '(', ')'), nested(2000, '{(', ')}'), '{('.repeat(3000)]) {
      assert.ok(pattern.length < 10000)
      assert.throws(() => run(pattern), bounded)
    }
  })
}
test('100 nesting levels remain accepted; 101 are rejected including mixed nesting', () => {
  for (const [open, close] of [
    ['{', '}'],
    ['(', ')'],
    ['{(', ')}'],
  ]) {
    const count = 100 / open.length
    assert.doesNotThrow(() => braces.compile(nested(count, open, close)))
    assert.doesNotThrow(() => braces.expand(nested(count, open, close)))
    assert.throws(() => braces.parse(nested(count, open, close).replace('a,b', '{a,b}')), bounded)
  }
  assert.throws(() => braces.parse(nested(101), {maxLength: Infinity, maxDepth: Infinity}), bounded)
})
test('quoted, escaped, bracketed delimiters and many sibling groups do not count as nesting', () => {
  const literal = '{('.repeat(300)
  assert.equal(braces.stringify('"' + literal + '"'), literal)
  assert.equal(braces.stringify(literal.replace(/[{}()]/g, '\\$&')), literal)
  assert.equal(braces.stringify('[' + literal + ']'), '[' + literal + ']')
  assert.equal(braces.stringify('{a,b}'.repeat(300)), '{a,b}'.repeat(300))
})
test('normal compilation, expansion and range protections are preserved', () => {
  assert.deepEqual(braces.expand('src/{a,{b,c}}/{01..03}'), [
    'src/a/01',
    'src/a/02',
    'src/a/03',
    'src/b/01',
    'src/b/02',
    'src/b/03',
    'src/c/01',
    'src/c/02',
    'src/c/03',
  ])
  assert.equal(braces.compile('a/{b,c}/d'), 'a/(b|c)/d')
  assert.equal(braces.stringify(braces.parse('a/{b,c}/d')), 'a/{b,c}/d')
  assert.throws(() => braces.expand('{1..10000}'), /range limit/)
  assert.throws(() => braces.parse('a'.repeat(10001)), /max characters/)
})
for (const name of ['compile', 'expand', 'stringify']) {
  test(`${name} also bounds externally supplied ASTs`, () => {
    let ast = {type: 'text', value: 'x'}
    for (let n = 0; n < 4500; n++) ast = {type: 'root', nodes: [ast]}
    assert.throws(() => braces[name](ast), bounded)
  })
}
