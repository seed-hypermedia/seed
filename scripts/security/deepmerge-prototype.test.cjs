'use strict'
// https://github.com/advisories/GHSA-gcqx-w48m-w2h4
const assert = require('node:assert/strict')
const {test} = require('node:test')
const {createRequire} = require('node:module')
const {resolve, dirname} = require('node:path')
const jestRequire = createRequire(resolve('frontend/apps/perf-web/package.json'))
const configRequire = createRequire(jestRequire.resolve('jest-config'))
const packageDir = process.env.DEEPMERGE_PACKAGE || dirname(configRequire.resolve('deepmerge/package.json'))

for (const entry of ['dist/cjs.js', 'dist/umd.js']) {
  const merge = require(resolve(packageDir, entry))
  test(`${entry}: prototype keys cannot poison the result from either input`, () => {
    const malicious = JSON.parse('{"__proto__":{"isAdmin":true},"safe":1}')
    for (const [target, source] of [
      [malicious, {}],
      [{}, malicious],
      [Object.create(null), malicious],
    ]) {
      const result = merge(target, source)
      assert.equal(Object.getPrototypeOf(result), Object.prototype)
      assert.equal(result.isAdmin, undefined)
      assert.equal(result.safe, 1)
    }
    const nested = merge({}, {users: [malicious]})
    assert.equal(nested.users[0].isAdmin, undefined)
    assert.equal(Object.prototype.isAdmin, undefined)
  })
  test(`${entry}: normal nested objects, arrays and symbols still merge`, () => {
    const key = Symbol('setting')
    assert.deepEqual(merge({a: {x: 1}, list: [1], [key]: 3}, {a: {y: 2}, list: [2]}), {
      a: {x: 1, y: 2},
      list: [1, 2],
      [key]: 3,
    })
  })
}
