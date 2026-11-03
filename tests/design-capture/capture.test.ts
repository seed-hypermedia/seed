import {describe, expect, it} from 'vitest'
import {CAPTURE_THEMES, CAPTURE_VIEWPORTS, captureFileName, captureViews, createManifest} from './capture-utils'

describe('design capture plan', () => {
  it('defines stable themes, viewports, and surface view lists', () => {
    expect(CAPTURE_THEMES).toEqual(['light', 'dark'])
    expect(CAPTURE_VIEWPORTS).toEqual({
      desktop: {width: 1440, height: 900},
      mobile: {width: 390, height: 844},
    })
    expect(captureViews('web')).toEqual([
      'home',
      'article',
      'article-discussion',
      'notes-table',
      'notes-list',
      'notes-cards',
      'search-command',
      'not-found',
    ])
  })

  it('creates safe screenshot paths and the requested manifest shape', () => {
    expect(captureFileName('web', 'Article / Design', 'dark', 'mobile')).toBe('web/article-design--dark--mobile.png')
    expect(createManifest('abc123', '2026-01-01T00:00:00.000Z')).toEqual({
      commit: 'abc123',
      createdAt: '2026-01-01T00:00:00.000Z',
      surfaces: {},
      failures: [],
    })
  })
})
