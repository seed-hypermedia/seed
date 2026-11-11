'use strict'
// https://github.com/advisories/GHSA-g3hv-75wg-m249
// https://github.com/advisories/GHSA-3g3m-2fjr-6pw4
const assert = require('node:assert/strict')
const {test} = require('node:test')
const fs = require('node:fs')
const {resolve, join, dirname} = require('node:path')
const {pathToFileURL} = require('node:url')
const {tmpdir} = require('node:os')
const packages = []

// Inspect all hoisted and nested versions, including workspace-local dependencies.
function scanModules(directory) {
  if (!fs.existsSync(directory)) return
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const path = join(directory, entry.name)
    if (entry.name.startsWith('@')) {
      scanModules(path)
      continue
    }
    if (['glob', 'minimatch'].includes(entry.name)) packages.push(path)
    scanModules(join(path, 'node_modules'))
  }
}
if (process.env.GLOB_TEST_PACKAGE) {
  packages.push(process.env.GLOB_TEST_PACKAGE)
} else {
  for (const workspace of ['', 'docs', 'tests', 'apps/protocol', 'frontend/scripts']) {
    scanModules(resolve(workspace, 'node_modules'))
  }
  for (const parent of ['frontend/apps', 'frontend/packages']) {
    for (const child of fs.readdirSync(parent)) scanModules(resolve(parent, child, 'node_modules'))
  }
}
assert.ok(packages.length > 0, 'Must check installed dependencies')

for (const directory of packages) {
  const metadata = JSON.parse(fs.readFileSync(join(directory, 'package.json')))
  if (!['glob', 'minimatch'].includes(metadata.name)) continue
  const major = Number(metadata.version.split('.')[0])
  const entrypoints = metadata.exports?.['.']
  const files = entrypoints
    ? [
        ...new Set(
          ['require', 'import'].map((kind) => {
            const entry = entrypoints[kind]
            return typeof entry === 'string' ? entry : entry.default
          }),
        ),
      ]
    : [metadata.main || 'index.js']
  for (const file of files) {
    test(`${directory}/${file}: bounded processing and existing API`, async () => {
      const module = await import(pathToFileURL(resolve(directory, file)))
      if (metadata.name === 'minimatch') {
        const {Minimatch} = module.Minimatch ? module : module.default
        const normal = new Minimatch('src/{a,b}/*.js', {optimizationLevel: 2})
        assert.ok(normal.match('src/a/test.js'))
        assert.equal(normal.match('src/c/test.js'), false)
        assert.ok(normal.makeRe() instanceof RegExp)
        if (major < 7) {
          // These versions have no affected preprocessing implementation.
          assert.equal(normal.firstPhasePreProcess, undefined)
          assert.equal(normal.secondPhasePreProcess, undefined)
        } else {
          // Small enough to fail safely before the patch (1024 vs the limit 64).
          const pattern = Array(10).fill('**/../a/b').join('/')
          const bounded = new Minimatch(pattern, {optimizationLevel: 2, braceExpandMax: 64})
          assert.equal(bounded.set.length, 64)
          const large = new Minimatch('{x,*}/{0..999}', {optimizationLevel: 2})
          assert.equal(large.set.length, 2000)
          assert.ok(large.match('y/999'))
        }
      } else if (major >= 9) {
        const controller = new AbortController()
        controller.abort(new Error('cancel traversal'))
        // Exercise all four upstream abort guards. Any work after the callback
        // touches the sentinel processor/target and fails synchronously.
        const walker = await import(pathToFileURL(join(dirname(resolve(directory, file)), 'walker.js')))
        const instance = new walker.GlobWalker([], [], {signal: controller.signal})
        for (const method of ['walkCB', 'walkCB2', 'walkCBSync', 'walkCB2Sync']) {
          let calls = 0
          const callback = () => {
            calls++
          }
          const target = {
            isUnknown: () => {
              throw new Error('traversal after abort')
            },
          }
          if (method.includes('CB2')) instance[method](target, [], undefined, callback)
          else instance[method](target, [], callback)
          assert.equal(calls, 1)
        }
        const glob = module.globSync ? module : module.default
        assert.ok(glob.globSync('package.json', {cwd: process.cwd()}).includes('package.json'))
        assert.ok((await glob.glob('package.json', {cwd: process.cwd()})).includes('package.json'))
        // Exercise the public entrypoint too: glob 13 otherwise uses a bundled
        // walker instead of the separately patched walker.js.
        const cwd = fs.mkdtempSync(join(tmpdir(), 'seed-glob-abort-'))
        try {
          fs.mkdirSync(join(cwd, 'a', 'b'), {recursive: true})
          const abort = new AbortController()
          const reason = new Error('stop reading')
          let reads = 0
          const stream = glob.globStreamSync('**', {
            cwd,
            signal: abort.signal,
            fs: {
              ...fs,
              readdirSync(...args) {
                reads++
                abort.abort(reason)
                return fs.readdirSync(...args)
              },
            },
          })
          await assert.rejects(
            new Promise((resolve, reject) => {
              stream.on('error', reject).on('end', resolve).resume()
            }),
            reason,
          )
          assert.equal(reads, 1)
        } finally {
          fs.rmSync(cwd, {recursive: true, force: true})
        }
      }
    })
  }
}
