import {describe, expect, it} from 'vitest'
import {parse} from 'yaml'
import release from '../../electron-release.json'
import desktop from '../../package.json'
// pnpm 11 keeps the workspace overrides in pnpm-workspace.yaml, not package.json#pnpm.
import workspaceYaml from '../../../../../pnpm-workspace.yaml?raw'

const workspace = parse(workspaceYaml) as {overrides: Record<string, string>}

describe('bundled Electron release', () => {
  it('keeps the release metadata and workspace override aligned with the desktop pin', () => {
    expect(release.version).toBe(desktop.devDependencies.electron)
    expect(workspace.overrides.electron).toBe(release.version)
    expect(Number.isFinite(Date.parse(release.releasedAt))).toBe(true)
  })
})
