import {InlineDraftCard} from '@shm/ui/inline-draft-card'
import {InlineDraftListItem} from '@shm/ui/inline-draft-list-item'
import {isValidElement, ReactNode} from 'react'
import {describe, expect, it, vi} from 'vitest'
import {buildSlotItems} from '@shm/ui/query-block-draft-items'

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

function draftHandlers() {
  return {onOpenDraft: vi.fn(), onDeleteDraft: vi.fn(), onUpdateDraftName: vi.fn()}
}

function elementTypes(items: ReactNode[] | undefined) {
  return items?.filter(isValidElement).map((item) => item.type) ?? []
}

describe('buildSlotItems', () => {
  it('returns nothing without drafts, leaving the "New document" entry to QueryBlockContent', () => {
    expect(buildSlotItems(makeSlot(), 'Card', true)).toEqual({})
    expect(buildSlotItems(makeSlot(), 'List', false)).toEqual({})
    expect(buildSlotItems(makeSlot(), 'Table', false)).toEqual({})
  })

  it('renders list drafts without a create button', () => {
    const result = buildSlotItems(makeSlot({drafts: [makeDraft('1')], ...draftHandlers()}), 'List', false)

    expect(elementTypes(result.prependItems)).toEqual([InlineDraftListItem])
  })

  it('passes table drafts through for the table to render as rows', () => {
    const slot = makeSlot({drafts: [makeDraft('1')], ...draftHandlers()})

    expect(buildSlotItems(slot, 'Table', false)).toEqual({tableDrafts: slot})
  })

  it('renders the first draft as the banner and the rest as cards', () => {
    const result = buildSlotItems(
      makeSlot({drafts: [makeDraft('1'), makeDraft('2')], ...draftHandlers()}),
      'Card',
      true,
    )

    expect(isValidElement(result.bannerContent)).toBe(true)
    expect(elementTypes(result.prependItems)).toEqual([InlineDraftCard])
  })
})
