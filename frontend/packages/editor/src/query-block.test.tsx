import {InlineDraftCard} from '@shm/ui/inline-draft-card'
import {NewDocumentCard} from '@shm/ui/new-document-card'
import {NewDocumentListItem} from '@shm/ui/new-document-list-item'
import {isValidElement, ReactNode} from 'react'
import {describe, expect, it, vi} from 'vitest'
import {buildSlotItems} from './query-block-draft-items'

function makeSlot(overrides: Partial<Parameters<typeof buildSlotItems>[0]> = {}) {
  return {
    drafts: [],
    onCreateDraft: vi.fn(),
    ...overrides,
  } as NonNullable<Parameters<typeof buildSlotItems>[0]>
}

function makeDraft(id: string) {
  return {
    draft: {
      id,
      metadata: {name: `Draft ${id}`},
    },
  } as NonNullable<Parameters<typeof buildSlotItems>[0]>['drafts'][number]
}

function elementTypes(items: ReactNode[] | undefined) {
  return items?.filter(isValidElement).map((item) => item.type) ?? []
}

describe('buildSlotItems', () => {
  it('omits the new document card when a card query block will render a document banner', () => {
    const result = buildSlotItems(makeSlot(), 'Card', true, true)

    expect(result.prependItems).toBeUndefined()
    expect(result.bannerContent).toBeUndefined()
  })

  it('keeps the new document card when banner mode has no banner to render yet', () => {
    const result = buildSlotItems(makeSlot(), 'Card', true, false)

    expect(elementTypes(result.prependItems)).toEqual([NewDocumentCard])
  })

  it('keeps the new document list item because list query blocks do not render banners', () => {
    const result = buildSlotItems(makeSlot(), 'List', true, true)

    expect(elementTypes(result.prependItems)).toEqual([NewDocumentListItem])
  })

  it('omits only the new document card when a draft renders as the banner', () => {
    const result = buildSlotItems(
      makeSlot({
        drafts: [makeDraft('1'), makeDraft('2')],
        onOpenDraft: vi.fn(),
        onDeleteDraft: vi.fn(),
        onUpdateDraftName: vi.fn(),
      }),
      'Card',
      true,
      false,
    )

    expect(isValidElement(result.bannerContent)).toBe(true)
    expect(elementTypes(result.prependItems)).toEqual([InlineDraftCard])
  })
})
