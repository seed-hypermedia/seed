/**
 * The board screen. State flow:
 *
 *   seed.getResource(boardId) ──▶ board (React state) ──▶ seed.sign.document(...)
 *
 * `boardId` is the document at the mount path (`hm://<site>/<mountPath>`).
 * Saving is manual by default because every save opens a confirmation dialog
 * in the host; auto-save is an opt-in remembered with seed.storage.
 */

import {
  applyTheme,
  type ExtensionContext,
  type HMDocumentInfo,
  type HMQueryResult,
  type SeedExtension,
} from '@seed-hypermedia/extension-sdk'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {
  addCard,
  addColumn,
  defaultBoard,
  KANBAN_METADATA_KEY,
  moveCard,
  parseBoard,
  removeCard,
  removeColumn,
  renameColumn,
  updateCard,
  type KanbanBoard,
  type KanbanCard,
} from './board'
import {CardEditor, type CardDraft} from './components/CardEditor'
import {Column} from './components/Column'
import {Header} from './components/Header'
import {describeError} from './errors'

const AUTOSAVE_STORAGE_KEY = 'autosave'
const AUTOSAVE_DELAY_MS = 1000

type Editing = {columnId: string; card?: KanbanCard}

export function App({seed}: {seed: SeedExtension}) {
  const [context, setContext] = useState<ExtensionContext>(seed.context)
  useEffect(() => seed.onContext(setContext), [seed])
  useEffect(() => applyTheme(context), [context.theme])

  const boardId = `hm://${context.site.uid}/${context.mountPath}`

  const [board, setBoard] = useState<KanbanBoard>(defaultBoard)
  const [savedJson, setSavedJson] = useState<string | null>(null) // null = document does not exist yet
  const [docName, setDocName] = useState('Board')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<{text: string; kind: 'info' | 'error'} | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [autoSave, setAutoSave] = useState(false)
  const [siteDocs, setSiteDocs] = useState<HMDocumentInfo[] | null>(null)

  const dirty = JSON.stringify(board) !== savedJson
  const canSave = !!context.user && seed.hasPermission('sign')

  // ── Load ──

  const load = useCallback(async () => {
    setLoading(true)
    setMessage(null)
    try {
      const resource = await seed.getResource(boardId)
      if (resource.type === 'document') {
        const parsed = parseBoard(resource.document.metadata[KANBAN_METADATA_KEY])
        const next = parsed ?? defaultBoard()
        setBoard(next)
        setSavedJson(parsed ? JSON.stringify(next) : null)
        setDocName(resource.document.metadata.name || 'Board')
      } else {
        // not-found / tombstone / redirect: start fresh; the first save creates the document.
        setBoard(defaultBoard())
        setSavedJson(null)
      }
    } catch (error) {
      setMessage({text: describeError(error), kind: 'error'})
    } finally {
      setLoading(false)
    }
  }, [seed, boardId])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!seed.hasPermission('storage')) return
    seed.storage
      .get(AUTOSAVE_STORAGE_KEY)
      .then((value) => setAutoSave(value === '1'))
      .catch(() => {})
  }, [seed])

  // ── Save ──

  const save = useCallback(async () => {
    if (!canSave || saving) return
    setSaving(true)
    setMessage(null)
    try {
      const json = JSON.stringify(board)
      await seed.sign.document({
        id: boardId,
        metadata: {name: docName, [KANBAN_METADATA_KEY]: board},
        summary: savedJson === null ? 'Create the kanban board document' : 'Update the kanban board',
      })
      setSavedJson(json)
      void seed.toast('Board saved', 'success')
    } catch (error) {
      setMessage({text: describeError(error), kind: 'error'})
    } finally {
      setSaving(false)
    }
  }, [seed, boardId, board, docName, savedJson, canSave, saving])

  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    if (!autoSave || !dirty || !canSave || loading) return
    const timer = setTimeout(() => void saveRef.current(), AUTOSAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [autoSave, dirty, canSave, loading, board])

  const toggleAutoSave = async (enabled: boolean) => {
    setAutoSave(enabled)
    try {
      await seed.storage.set(AUTOSAVE_STORAGE_KEY, enabled ? '1' : '0')
    } catch (error) {
      setMessage({text: describeError(error), kind: 'error'})
    }
  }

  // ── Site documents for the link picker (loaded once, on first use) ──

  useEffect(() => {
    if (!editing || siteDocs !== null) return
    let cancelled = false
    ;(async () => {
      try {
        const result = (await seed.query('Query', {
          includes: [{space: context.site.uid, mode: 'AllDescendants'}],
          sort: [{term: 'Title', reverse: false}],
        })) as HMQueryResult | null
        if (!cancelled) setSiteDocs(result?.results ?? [])
      } catch (error) {
        if (cancelled) return
        setMessage({text: describeError(error), kind: 'error'})
        setSiteDocs([])
      }
    })()
    return () => {
      cancelled = true
    }
  }, [seed, context.site.uid, editing, siteDocs])

  // ── Card editing ──

  const submitCard = (draft: CardDraft) => {
    if (!editing) return
    if (editing.card) setBoard((b) => updateCard(b, {...editing.card!, ...draft}))
    else setBoard((b) => addCard(b, editing.columnId, draft))
    setEditing(null)
  }

  const open = async (url: string) => {
    try {
      await seed.navigate(url)
    } catch (error) {
      setMessage({text: describeError(error), kind: 'error'})
    }
  }

  const columns = useMemo(() => board.columns, [board])

  return (
    <div className="app">
      <Header
        title={docName}
        user={context.user}
        dirty={dirty}
        saving={saving}
        canSave={canSave}
        autoSave={autoSave}
        onSave={() => void save()}
        onReload={() => void load()}
        onToggleAutoSave={(v) => void toggleAutoSave(v)}
        onAddColumn={() => {
          const title = window.prompt('Column title')
          if (title?.trim()) setBoard((b) => addColumn(b, title.trim()))
        }}
      />
      {message && <p className={`banner ${message.kind}`}>{message.text}</p>}
      {!context.user && (
        <p className="banner info">You are not signed in. You can browse the board but not save changes.</p>
      )}
      {loading ? (
        <p className="muted padded">Loading board…</p>
      ) : (
        <div className="board">
          {columns.map((column) => (
            <Column
              key={column.id}
              column={column}
              cards={column.cardIds.map((id) => board.cards[id]).filter((c): c is KanbanCard => !!c)}
              onRename={(title) => setBoard((b) => renameColumn(b, column.id, title))}
              onRemove={() => {
                if (window.confirm(`Delete column “${column.title}” and its cards?`))
                  setBoard((b) => removeColumn(b, column.id))
              }}
              onAddCard={() => setEditing({columnId: column.id})}
              onEditCard={(card) => setEditing({columnId: column.id, card})}
              onRemoveCard={(card) => setBoard((b) => removeCard(b, card.id))}
              onOpenCard={(card) => card.link && void open(card.link)}
              onDropCard={(cardId, beforeCardId) => setBoard((b) => moveCard(b, cardId, column.id, beforeCardId))}
            />
          ))}
        </div>
      )}
      {editing && (
        <CardEditor card={editing.card} siteDocs={siteDocs} onSubmit={submitCard} onCancel={() => setEditing(null)} />
      )}
    </div>
  )
}
