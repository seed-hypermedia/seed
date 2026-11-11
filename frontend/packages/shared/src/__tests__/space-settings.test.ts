import {describe, expect, it} from 'vitest'
import {readSpaceSettings, resolveDocumentDisplay} from '../space-settings'

describe('readSpaceSettings', () => {
  it('treats every absent key as on, so spaces published before the keys existed are unchanged', () => {
    expect(readSpaceSettings({})).toEqual({
      showConversations: true,
      showActivity: true,
      showDocumentBrowser: true,
      showCollectionControls: true,
    })
    expect(readSpaceSettings(undefined)).toEqual(readSpaceSettings({}))
  })

  it('only false turns a setting off', () => {
    expect(readSpaceSettings({showDocumentBrowser: false}).showDocumentBrowser).toBe(false)
    expect(readSpaceSettings({showDocumentBrowser: true}).showDocumentBrowser).toBe(true)
  })
})

describe('resolveDocumentDisplay', () => {
  it("applies the space's content width and outline over a document's older values", () => {
    const display = resolveDocumentDisplay(
      {contentWidth: 'S', showOutline: false},
      {contentWidth: 'L', showOutline: true},
    )
    expect(display.contentWidth).toBe('L')
    expect(display.showOutline).toBe(true)
  })

  it("keeps a document's own values where the space never set any", () => {
    const display = resolveDocumentDisplay({contentWidth: 'S', showOutline: false}, {name: 'Space'})
    expect(display.contentWidth).toBe('S')
    expect(display.showOutline).toBe(false)
  })

  it('shows activity tabs only when neither the document nor the space hides them', () => {
    expect(resolveDocumentDisplay({}, {}).showActivity).toBe(true)
    expect(resolveDocumentDisplay({}, {showActivity: false}).showActivity).toBe(false)
    expect(resolveDocumentDisplay({showActivity: false}, {showActivity: true}).showActivity).toBe(false)
  })

  it('falls back to the defaults before the home document loads', () => {
    expect(resolveDocumentDisplay(undefined, undefined)).toEqual({
      contentWidth: undefined,
      showOutline: true,
      showActivity: true,
    })
  })
})
