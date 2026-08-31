/**
 * The board model. Everything here is pure: functions take a board and return
 * a new one, so React state stays immutable and saving is a JSON comparison.
 */

export const KANBAN_METADATA_KEY = 'kanban'

export type KanbanCard = {
  id: string
  title: string
  note?: string
  /** `hm://` URL of a related document. */
  link?: string
}

export type KanbanColumn = {
  id: string
  title: string
  cardIds: string[]
}

export type KanbanBoard = {
  columns: KanbanColumn[]
  cards: Record<string, KanbanCard>
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID().slice(0, 8)
  return Math.random().toString(36).slice(2, 10)
}

export function defaultBoard(): KanbanBoard {
  return {
    columns: ['Todo', 'Doing', 'Done'].map((title) => ({id: newId(), title, cardIds: []})),
    cards: {},
  }
}

/** Lenient validation of whatever is stored in the document metadata. Returns null if it is not a board. */
export function parseBoard(value: unknown): KanbanBoard | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as {columns?: unknown; cards?: unknown}
  if (!Array.isArray(raw.columns) || !raw.cards || typeof raw.cards !== 'object') return null
  const cards: Record<string, KanbanCard> = {}
  for (const [id, card] of Object.entries(raw.cards as Record<string, unknown>)) {
    if (!card || typeof card !== 'object') continue
    const c = card as Partial<KanbanCard>
    if (typeof c.title !== 'string') continue
    cards[id] = {id, title: c.title}
    if (typeof c.note === 'string' && c.note) cards[id].note = c.note
    if (typeof c.link === 'string' && c.link) cards[id].link = c.link
  }
  const columns: KanbanColumn[] = []
  for (const column of raw.columns) {
    if (!column || typeof column !== 'object') continue
    const col = column as Partial<KanbanColumn>
    if (typeof col.id !== 'string' || typeof col.title !== 'string') continue
    const cardIds = Array.isArray(col.cardIds)
      ? col.cardIds.filter((id): id is string => typeof id === 'string' && id in cards)
      : []
    columns.push({id: col.id, title: col.title, cardIds})
  }
  return {columns, cards}
}

export function addColumn(board: KanbanBoard, title: string): KanbanBoard {
  return {...board, columns: [...board.columns, {id: newId(), title, cardIds: []}]}
}

export function renameColumn(board: KanbanBoard, columnId: string, title: string): KanbanBoard {
  return {...board, columns: board.columns.map((c) => (c.id === columnId ? {...c, title} : c))}
}

export function removeColumn(board: KanbanBoard, columnId: string): KanbanBoard {
  const column = board.columns.find((c) => c.id === columnId)
  if (!column) return board
  const cards = {...board.cards}
  for (const id of column.cardIds) delete cards[id]
  return {columns: board.columns.filter((c) => c.id !== columnId), cards}
}

export function addCard(board: KanbanBoard, columnId: string, card: Omit<KanbanCard, 'id'>): KanbanBoard {
  const id = newId()
  return {
    columns: board.columns.map((c) => (c.id === columnId ? {...c, cardIds: [...c.cardIds, id]} : c)),
    cards: {...board.cards, [id]: {...card, id}},
  }
}

export function updateCard(board: KanbanBoard, card: KanbanCard): KanbanBoard {
  return {...board, cards: {...board.cards, [card.id]: card}}
}

export function removeCard(board: KanbanBoard, cardId: string): KanbanBoard {
  const cards = {...board.cards}
  delete cards[cardId]
  return {columns: board.columns.map((c) => ({...c, cardIds: c.cardIds.filter((id) => id !== cardId)})), cards}
}

/** Move a card to `toColumnId`, inserted before `beforeCardId` (or at the end when omitted). */
export function moveCard(board: KanbanBoard, cardId: string, toColumnId: string, beforeCardId?: string): KanbanBoard {
  if (cardId === beforeCardId) return board
  const columns = board.columns.map((c) => ({...c, cardIds: c.cardIds.filter((id) => id !== cardId)}))
  const target = columns.find((c) => c.id === toColumnId)
  if (!target) return board
  const index = beforeCardId ? target.cardIds.indexOf(beforeCardId) : -1
  if (index === -1) target.cardIds.push(cardId)
  else target.cardIds.splice(index, 0, cardId)
  return {...board, columns}
}
