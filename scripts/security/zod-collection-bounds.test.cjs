'use strict'
// GHSA-mrhx-c7xc-m3w5: verify Zod 4 and the patched v3 compatibility runtime used by Seed.
// https://github.com/colinhacks/zod/commit/a0ebf970f2d752e5f58527cd2942ff48be4f46bd
const assert = require('node:assert/strict')
const {test} = require('node:test')
const path = require('node:path')
const {pathToFileURL} = require('node:url')
const packageRoot = process.env.ZOD_PACKAGE || path.dirname(require.resolve('zod/package.json'))

for (const version of ['v3', 'v4']) {
  for (const format of ['cjs', 'js']) {
    test(`${version} ${format} rejects oversized collections before parsing elements`, async () => {
      const entry = path.join(packageRoot, version, `index.${format}`)
      const {z} = format === 'cjs' ? require(entry) : await import(pathToFileURL(entry).href)
      let visits = 0
      const element = z.preprocess((value) => {
        visits++
        return value
      }, z.string())
      const values = Array.from({length: 1000}, (_, i) => i)
      const cases = [
        [z.array(element).max(2, 'Too many'), values],
        [z.array(element).length(2, 'Too many'), values],
        [z.set(element).max(2, 'Too many'), new Set(values)],
        [z.set(element).size(2, 'Too many'), new Set(values)],
      ]
      if (version === 'v4') {
        cases.push([
          z.map(element, element).check(z.maxSize(2, 'Too many')),
          new Map(values.map((value) => [value, value])),
        ])
        assert.deepEqual(
          z
            .array(z.number())
            .overwrite((items) => items.slice(0, 2))
            .max(2)
            .parse([1, 2, 3]),
          [1, 2],
        )
      }
      for (const [schema, input] of cases) {
        for (const parse of [(value) => schema.safeParse(value), (value) => schema.safeParseAsync(value)]) {
          const result = await parse(input)
          assert.equal(result.success, false)
          assert.equal(result.error.issues.length, 1)
          assert.equal(result.error.issues[0].code, 'too_big')
          assert.equal(result.error.issues[0].message, 'Too many')
          assert.equal(visits, 0)
        }
      }
      const nested = z.object({records: z.array(element).max(2)}).safeParse({records: values})
      assert.deepEqual(
        nested.error.issues.map((issue) => issue.path),
        [['records']],
      )
      assert.equal(visits, 0)
      assert.deepEqual(z.array(element).max(2).parse(['a', 'b']), ['a', 'b'])
      assert.equal(visits, 2)
      assert.equal(z.array(z.string()).max(2).safeParse([1]).error.issues[0].code, 'invalid_type')
      assert.equal(z.array(z.string()).min(2).safeParse([]).error.issues[0].code, 'too_small')
      assert.equal(z.array(z.string()).max(2).safeParse('bad').error.issues[0].code, 'invalid_type')
    })
  }
}
