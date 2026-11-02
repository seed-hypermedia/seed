import {describe, expect, it} from 'vitest'
import {checkElectronSupport, electronOverrideFromWorkspace} from '../../scripts/check-electron-support.mjs'

const releases = ['45.0.0-beta.1', '44.5.1', '43.7.7', '42.11.10', '39.8.10'].map((version) => ({version}))

describe('Electron support policy', () => {
  it.each(['44.5.1', '43.7.7', '42.11.10'])('accepts supported stable release %s', (version) => {
    expect(checkElectronSupport(version, releases)).toBe(44)
  })
  it.each(['39.8.10', '45.0.0', '^44.5.1', '45.0.0-beta.1', '44.999.0'])('rejects %s', (version) => {
    expect(() => checkElectronSupport(version, releases)).toThrow()
  })
  it('fails closed if the index is empty or malformed', () => {
    expect(() => checkElectronSupport('44.5.1', [])).toThrow()
    expect(() => checkElectronSupport('44.5.1', {})).toThrow()
  })
})

describe('electron override in pnpm-workspace.yaml', () => {
  const workspace = (overrides: string) =>
    [
      'packages:',
      "  - 'frontend/apps/*'",
      'allowBuilds:',
      '  electron: true',
      'overrides:',
      overrides,
      'nodeLinker: hoisted',
    ].join('\n')
  it('reads a bare or quoted scalar and ignores other blocks', () => {
    expect(electronOverrideFromWorkspace(workspace('  react: 18.2.0\n  electron: 44.9.3'))).toBe('44.9.3')
    expect(electronOverrideFromWorkspace(workspace('  "electron": "44.9.3"'))).toBe('44.9.3')
  })
  it('fails closed when the block or the entry is missing', () => {
    expect(() => electronOverrideFromWorkspace(workspace('  react: 18.2.0'))).toThrow()
    expect(() => electronOverrideFromWorkspace('packages:\n  - x\nallowBuilds:\n  electron: true\n')).toThrow()
  })
})
