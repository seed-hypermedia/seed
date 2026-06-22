import {describe, expect, it} from 'vitest'
import {getSidebarTitlebarWidth} from '../sidebar-context'

describe('getSidebarTitlebarWidth', () => {
  it('uses the measured sidebar pixel width when the sidebar is locked', () => {
    expect(getSidebarTitlebarWidth({isLocked: true, sidebarWidthPx: 283.6})).toBe('284px')
  })

  it('does not project panel percentages into viewport units', () => {
    expect(getSidebarTitlebarWidth({isLocked: true, sidebarWidthPx: null})).toBeUndefined()
    expect(getSidebarTitlebarWidth({isLocked: false, sidebarWidthPx: 284})).toBeUndefined()
  })
})
