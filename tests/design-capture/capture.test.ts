import {describe, expect, it} from 'vitest'
import {
  CAPTURE_THEMES,
  CAPTURE_VIEWPORTS,
  captureFileName,
  captureViews,
  createManifest,
  unionCaptureBounds,
} from './capture-utils'

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
      fonts: {},
    })
  })

  it('unions content bounds, adds padding, and clamps the result to the viewport', () => {
    expect(
      unionCaptureBounds(
        [
          {x: 12, y: 30, width: 80, height: 40},
          {x: 110, y: 50, width: 40, height: 30},
        ],
        {width: 1440, height: 900},
      ),
    ).toEqual({x: 0, y: 6, width: 174, height: 98})

    expect(unionCaptureBounds([{x: 1400, y: 880, width: 80, height: 60}], {width: 1440, height: 900})).toEqual({
      x: 1376,
      y: 856,
      width: 64,
      height: 44,
    })
    expect(unionCaptureBounds([], {width: 1440, height: 900})).toBeNull()
  })
})
