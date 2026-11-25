const assert = require('node:assert/strict')
const {test} = require('node:test')
const {notarize} = require('@electron/notarize')
const signatures = require('@electron/notarize/lib/check-signature')
const notarytool = require('@electron/notarize/lib/notarytool')
const subprocess = require('@electron/notarize/lib/spawn')

// Keep the installed notarization, stapling, and retry code real. Replace the
// Apple service and command boundaries so no signing credentials are needed.
for (const failsPermanently of [false, true]) {
  test(
    failsPermanently ? 'rejects when all stapling attempts fail' : 'recovers after three stapling failures',
    async (t) => {
      t.mock.method(signatures, 'checkSignatures', async () => {})
      t.mock.method(notarytool, 'isNotaryToolAvailable', async () => true)
      const submission = t.mock.method(notarytool, 'notarizeAndWaitForNotaryTool', async () => {})
      let attempts = 0
      t.mock.method(subprocess, 'spawn', async (command, args) => {
        assert.equal(command, 'xcrun')
        assert.deepEqual(args, ['stapler', 'staple', '-v', 'Seed.app'])
        attempts++
        return attempts <= 3 || failsPermanently
          ? {code: 68, output: 'The network connection was lost.'}
          : {code: 0, output: 'The staple and validate action worked!'}
      })

      const result = notarize({appPath: '/tmp/Seed.app'})
      if (failsPermanently) {
        await assert.rejects(result, /Failed to staple your application with code: 68/)
      } else {
        await result
      }
      assert.equal(attempts, 4)
      assert.equal(submission.mock.callCount(), 1)
    },
  )
}

test('does not staple or retry a rejected notarization', async (t) => {
  t.mock.method(signatures, 'checkSignatures', async () => {})
  t.mock.method(notarytool, 'isNotaryToolAvailable', async () => true)
  const rejection = new Error('Apple rejected notarization')
  const submission = t.mock.method(notarytool, 'notarizeAndWaitForNotaryTool', async () => {
    throw rejection
  })
  const command = t.mock.method(subprocess, 'spawn', async () => {
    assert.fail('Stapling must not run after notarization rejection')
  })

  await assert.rejects(notarize({appPath: '/tmp/Seed.app'}), (error) => error === rejection)
  assert.equal(submission.mock.callCount(), 1)
  assert.equal(command.mock.callCount(), 0)
})
