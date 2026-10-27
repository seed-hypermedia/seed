import {describe, expect, test} from 'vitest'
import {appNeedsOf, appSettingsLine, mountsByApp} from '../agents/apps'
import type {AppMountInfo} from '../agents/client'

describe('the Apps dialog catalog', () => {
  test('recognizes a mounted app by its page whatever version the mount pins', () => {
    // A mount drafted from the catalog pins the version it consented to, and the server reports
    // the app with that version; the catalog knows the page by its address alone. Matching the
    // two literally listed the app under "Apps you can mount" right after it was mounted.
    const mount = {slug: 'convert', app: 'hm://z6MkSpace/apps/convert?v=bafyreicg5jl'} as AppMountInfo
    const mounts = mountsByApp([mount, {slug: 'other', app: 'hm://z6MkSpace/apps/other'} as AppMountInfo])
    expect(mounts.get('hm://z6MkSpace/apps/convert')).toBe(mount)
    expect(mounts.get('hm://z6MkSpace/apps/other')?.slug).toBe('other')
    expect(mounts.has('hm://z6MkSpace/apps/convert?v=bafyreicg5jl')).toBe(false)
  })

  test('names the settings a mount page may carry, with the values a choice accepts, and never a secret', () => {
    const needs = appNeedsOf({
      arguments: {
        apiKey: {type: 'string', secret: true, required: true, order: 1},
        mode: {type: 'string', order: 2, choices: {fast: 'Fast', balanced: 'Balanced', accurate: 'Accurate'}},
        extras: {type: 'string', order: 3},
      },
    })
    expect(appSettingsLine(needs)).toBe(
      "Settings its mount page may carry under arguments: mode (fast, balanced, accurate), extras. Left unset, the app's defaults apply.",
    )
    expect(appSettingsLine(appNeedsOf({arguments: {apiKey: {type: 'string', secret: true}}}))).toBeNull()
  })
})
