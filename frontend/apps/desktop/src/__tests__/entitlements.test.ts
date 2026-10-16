// @vitest-environment node
import {readFileSync} from 'node:fs'
import path from 'node:path'
import {expect, it} from 'vitest'

/**
 * The macOS entitlements are part of the app's attack surface. Adding one back (camera,
 * microphone, location, devices, disabled library validation) must be a deliberate change here,
 * not a side effect of a signing tweak.
 */
it('grants only the entitlements the app needs', () => {
  const plist = readFileSync(path.join(__dirname, '../../entitlements.plist'), 'utf8')
  const keys = Array.from(plist.matchAll(/<key>([^<]+)<\/key>\s*<true\/>/g), (match) => match[1]).sort()
  expect(keys).toEqual([
    'com.apple.security.cs.allow-jit',
    'com.apple.security.cs.allow-unsigned-executable-memory',
    'com.apple.security.hypervisor',
  ])
  expect(plist).not.toContain('<false/>')
})
