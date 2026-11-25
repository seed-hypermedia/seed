import {QueryBlockDraftSlotData} from '@shm/shared/query-block-drafts-context'
import {InlineDraftCard} from './inline-draft-card'
import {InlineDraftListItem} from './inline-draft-list-item'
import {ReactNode} from 'react'

/**
 * Builds the draft elements that appear before query block results. The "New document" entry is
 * rendered by `QueryBlockContent` itself so every view places it first.
 */
export function buildSlotItems(
  slot: QueryBlockDraftSlotData | null,
  style: 'Card' | 'List' | 'Table',
  banner: boolean,
): {prependItems?: ReactNode[]; bannerContent?: ReactNode; tableDrafts?: QueryBlockDraftSlotData} {
  if (!slot) return {}
  const {drafts, onOpenDraft, onDeleteDraft, onMoveDraft, onUpdateDraftName} = slot
  const hasDrafts = drafts.length > 0 && !!onOpenDraft && !!onDeleteDraft && !!onUpdateDraftName
  if (!hasDrafts) return {}
  if (style === 'Table') return {tableDrafts: slot}

  if (style === 'Card') {
    const cards = drafts.map(({draft, autoFocus}) => (
      <InlineDraftCard
        key={`draft-${draft.id}`}
        draft={draft}
        autoFocus={autoFocus}
        onOpenDraft={onOpenDraft!}
        onDeleteDraft={onDeleteDraft!}
        onMoveDraft={onMoveDraft}
        onUpdateDraftName={onUpdateDraftName!}
      />
    ))
    if (banner && cards.length > 0) {
      const bannerDraft = drafts[0]!
      const bannerEl = (
        <InlineDraftCard
          key={`draft-banner-${bannerDraft.draft.id}`}
          draft={bannerDraft.draft}
          autoFocus={bannerDraft.autoFocus}
          banner
          onOpenDraft={onOpenDraft!}
          onDeleteDraft={onDeleteDraft!}
          onMoveDraft={onMoveDraft}
          onUpdateDraftName={onUpdateDraftName!}
        />
      )
      return {prependItems: cards.slice(1), bannerContent: bannerEl}
    }
    return {prependItems: cards}
  }

  const listItems = drafts.map(({draft, autoFocus}) => (
    <InlineDraftListItem
      key={`draft-${draft.id}`}
      draft={draft}
      autoFocus={autoFocus}
      onOpenDraft={onOpenDraft!}
      onDeleteDraft={onDeleteDraft!}
      onMoveDraft={onMoveDraft}
      onUpdateDraftName={onUpdateDraftName!}
    />
  ))
  return {prependItems: listItems}
}
