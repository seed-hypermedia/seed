import type {HMDocumentInfo} from '@seed-hypermedia/extension-sdk'
import {useState, type FormEvent} from 'react'
import type {KanbanCard} from '../board'

export type CardDraft = Pick<KanbanCard, 'title' | 'note' | 'link'>

type Props = {
  /** Existing card when editing; undefined when creating. */
  card?: KanbanCard
  /** Site documents for the link picker; null while loading. */
  siteDocs: HMDocumentInfo[] | null
  onSubmit: (draft: CardDraft) => void
  onCancel: () => void
}

export function CardEditor({card, siteDocs, onSubmit, onCancel}: Props) {
  const [title, setTitle] = useState(card?.title ?? '')
  const [note, setNote] = useState(card?.note ?? '')
  const [link, setLink] = useState(card?.link ?? '')

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    const draft: CardDraft = {title: title.trim()}
    if (note.trim()) draft.note = note.trim()
    if (link.trim()) draft.link = link.trim()
    onSubmit(draft)
  }

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2>{card ? 'Edit card' : 'New card'}</h2>
        <label>
          Title
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label>
          Note
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
        </label>
        <label>
          Link (hm:// URL)
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="hm://…" pattern="hm://.*" />
        </label>
        <label>
          Or pick a site document
          <select value="" onChange={(e) => e.target.value && setLink(e.target.value)}>
            <option value="">{siteDocs === null ? 'Loading…' : siteDocs.length ? 'Choose…' : 'No documents'}</option>
            {siteDocs?.map((doc) => (
              <option key={doc.id.id} value={doc.id.id}>
                {doc.metadata?.name || doc.path.join('/') || 'Home'}
              </option>
            ))}
          </select>
        </label>
        <div className="modal-actions">
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary">
            {card ? 'Save card' : 'Add card'}
          </button>
        </div>
      </form>
    </div>
  )
}
