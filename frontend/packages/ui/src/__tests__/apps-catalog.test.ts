import {describe, expect, test} from 'vitest'
import {appNeedsOf, appSettingsLine, installsByApp, toolReferenceLinks} from '../agents/apps'
import type {AppInstallInfo} from '../agents/client'

describe('the Apps dialog catalog', () => {
  test('an installed tool links what its page references: the code first, then the contract', () => {
    const tool = {
      tool: 'convert',
      summary: 'Converts.',
      runtime: 'ts' as const,
      code: 'ipfs://bafkcode',
      inputSchema: 'ipfs://bafyinput',
    }
    expect(toolReferenceLinks(tool)).toEqual([
      {label: 'code', url: 'ipfs://bafkcode'},
      {label: 'input', url: 'ipfs://bafyinput'},
    ])
    expect(toolReferenceLinks({...tool, outputSchema: 'ipfs://bafyoutput'}).map((link) => link.label)).toEqual([
      'code',
      'input',
      'output',
    ])
  })

  test('recognizes an installed app by its page whatever version the install pins', () => {
    // An install drafted from the catalog pins the version it consented to, and the server reports
    // the app with that version; the catalog knows the page by its address alone. Matching the
    // two literally listed the app under "Apps you can install" right after it was installed.
    const install = {slug: 'convert', app: 'hm://z6MkSpace/apps/convert?v=bafyreicg5jl'} as AppInstallInfo
    const installs = installsByApp([install, {slug: 'other', app: 'hm://z6MkSpace/apps/other'} as AppInstallInfo])
    expect(installs.get('hm://z6MkSpace/apps/convert')).toBe(install)
    expect(installs.get('hm://z6MkSpace/apps/other')?.slug).toBe('other')
    expect(installs.has('hm://z6MkSpace/apps/convert?v=bafyreicg5jl')).toBe(false)
  })

  test('names the settings an install page may carry, with the values a choice accepts, and never a secret', () => {
    const needs = appNeedsOf({
      arguments: {
        apiKey: {type: 'string', secret: true, required: true, order: 1},
        mode: {type: 'string', order: 2, choices: {fast: 'Fast', balanced: 'Balanced', accurate: 'Accurate'}},
        extras: {type: 'string', order: 3},
      },
    })
    expect(appSettingsLine(needs)).toBe(
      "Settings its install page may carry under arguments: mode (fast, balanced, accurate), extras. Left unset, the app's defaults apply.",
    )
    expect(appSettingsLine(appNeedsOf({arguments: {apiKey: {type: 'string', secret: true}}}))).toBeNull()
  })
})
