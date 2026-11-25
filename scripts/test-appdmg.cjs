const assert = require('node:assert/strict')
const {once} = require('node:events')
const path = require('node:path')
const {test} = require('node:test')

// Exercise the installed, patched dependency without creating or mounting a DMG.
for (const [name, background, error] of [
  ['reads the desktop background', 'frontend/apps/desktop/assets/dmg-background.png'],
  ['rejects an invalid image', 'package.json', /unsupported file type/i],
  ['reports a missing image', 'missing-dmg-background.png', /ENOENT/],
]) {
  test(name, {skip: process.platform !== 'darwin'}, async () => {
    const appdmg = require('appdmg')
    const pipeline = appdmg({
      target: 'unused.dmg',
      basepath: path.resolve(__dirname, '..'),
      specification: {background},
    })
    // appdmg schedules execution on the next tick. Keep only the real image
    // reading step so this test needs neither disk mounts nor signing keys.
    pipeline.steps = pipeline.steps.filter((step) => step.title === 'Reading background dimensions')
    assert.equal(pipeline.steps.length, 1)
    const finished = once(pipeline, 'finish')
    if (error) {
      await assert.rejects(finished, error)
    } else {
      await finished
    }
  })
}
