import {QueryBlockDraftSlotData} from '@shm/shared/query-block-drafts-context'
import {InlineDraftCard} from '@shm/ui/inline-draft-card'
import {InlineDraftListItem} from '@shm/ui/inline-draft-list-item'
import {NewDocumentCard} from '@shm/ui/new-document-card'
import {NewDocumentListItem} from '@shm/ui/new-document-list-item'
import {ReactNode} from 'react'

/** Builds draft and create-button elements that appear before query block results. */
export function buildSlotItems(
  slot: QueryBlockDraftSlotData | null,
  style: 'Card' | 'List',
  banner: boolean,
  hasQueryResults = false,
): {prependItems?: ReactNode[]; bannerContent?: ReactNode} {
  if (!slot) return {}
  const {drafts, onCreateDraft, onOpenDraft, onDeleteDraft, onMoveDraft, onUpdateDraftName} = slot
  const hasDrafts = drafts.length > 0 && !!onOpenDraft && !!onDeleteDraft && !!onUpdateDraftName
  const shouldHideCreateButton = style === 'Card' && banner && (hasDrafts || hasQueryResults)

  const createButton =
    onCreateDraft && !shouldHideCreateButton ? (
      style === 'Card' ? (
        <NewDocumentCard key="new-doc-btn" onCreateDraft={onCreateDraft} />
      ) : (
        <NewDocumentListItem key="new-doc-btn" onCreateDraft={onCreateDraft} />
      )
    ) : null

  if (!hasDrafts) {
    return createButton ? {prependItems: [createButton]} : {}
  }

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
      const remainingCards = cards.slice(1)
      return {
        prependItems: createButton ? [createButton, ...remainingCards] : remainingCards,
        bannerContent: bannerEl,
      }
    }
    return {prependItems: createButton ? [createButton, ...cards] : cards}
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
  return {prependItems: createButton ? [createButton, ...listItems] : listItems}
}
