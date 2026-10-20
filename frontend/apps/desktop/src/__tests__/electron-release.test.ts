import {describe, expect, it} from 'vitest'
import release from '../../electron-release.json'
import desktop from '../../package.json'
import workspace from '../../../../../package.json'

describe('bundled Electron release', () => {
  it('keeps the release metadata and workspace override aligned with the desktop pin', () => {
    expect(release.version).toBe(desktop.devDependencies.electron)
    expect(workspace.pnpm.overrides.electron).toBe(release.version)
    expect(Number.isFinite(Date.parse(release.releasedAt))).toBe(true)
  })
})
