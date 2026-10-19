// GHSA-cp6q-959q-f8rh: https://github.com/advisories/GHSA-cp6q-959q-f8rh
// Backport: https://github.com/ueberdosis/tiptap/commit/01d7af8c983ee5954c63734f4fa46cb23ae3246d
const assert = require('node:assert/strict')
const {test} = require('node:test')
const {dirname, resolve} = require('node:path')
const {pathToFileURL} = require('node:url')
const {DOMSerializer, Schema} = require('@tiptap/pm/model')
const {JSDOM} = require('jsdom')

// TIPTAP_CORE_PACKAGE allows the same tests to check an unpatched package.
const packageRoot = process.env.TIPTAP_CORE_PACKAGE || resolve(dirname(require.resolve('@tiptap/core')), '..')

for (const entrypoint of ['index.cjs', 'index.js']) {
  const core = import(pathToFileURL(resolve(packageRoot, 'dist', entrypoint)).href)

  test(`${entrypoint}: JSON attributes cannot change the merged prototype`, async () => {
    const {mergeAttributes} = await core
    const input = JSON.parse('{"__proto__":{"data-inherited-canary":"present"},"title":"safe"}')
    const attributes = mergeAttributes(input)

    assert.equal(Object.getPrototypeOf(attributes), Object.prototype)
    assert.equal(attributes['data-inherited-canary'], undefined)
    assert.deepEqual(Object.getOwnPropertyDescriptor(attributes, '__proto__'), {
      configurable: true,
      enumerable: true,
      value: input.__proto__,
      writable: true,
    })
    assert.equal(attributes.title, 'safe')
  })

  test(`${entrypoint}: serialized DOM excludes inherited attributes`, async () => {
    const {mergeAttributes} = await core
    const attributes = mergeAttributes(JSON.parse('{"__proto__":{"data-inherited-canary":"present"}}'))
    const schema = new Schema({
      nodes: {
        doc: {content: 'image'},
        image: {toDOM: () => ['img', attributes]},
        text: {},
      },
    })
    const dom = new JSDOM()
    try {
      const fragment = DOMSerializer.fromSchema(schema).serializeFragment(
        schema.node('doc', null, [schema.node('image')]).content,
        {document: dom.window.document},
      )
      assert.equal(fragment.firstChild.getAttribute('data-inherited-canary'), null)
    } finally {
      dom.window.close()
    }
  })

  test(`${entrypoint}: repeated prototype keys remain own data properties`, async () => {
    const {mergeAttributes} = await core
    for (const value of [null, 'text', {marker: true}]) {
      const attributes = mergeAttributes(
        JSON.parse('{"__proto__":{"old":true}}'),
        JSON.parse(JSON.stringify({['__proto__']: value})),
        {title: 'safe'},
      )
      assert.equal(Object.getPrototypeOf(attributes), Object.prototype)
      assert.ok(Object.hasOwn(attributes, '__proto__'))
      assert.deepEqual(attributes.__proto__, value)
      assert.equal(attributes.old, undefined)
      assert.equal(attributes.marker, undefined)
      assert.equal(attributes.title, 'safe')
    }
  })

  test(`${entrypoint}: ordinary attribute merging keeps Tiptap 2 behavior`, async () => {
    const {mergeAttributes} = await core
    assert.deepEqual(
      mergeAttributes(null, {class: 'first', style: 'color: red', title: 'old'}, false, {
        class: 'second',
        style: 'color: blue',
        title: 'new',
      }),
      {class: 'first second', style: 'color: red; color: blue', title: 'new'},
    )
    assert.deepEqual(mergeAttributes(), {})
  })
}
