import {useState, type DragEvent} from 'react'
import type {KanbanCard, KanbanColumn} from '../board'
import {Card} from './Card'

type Props = {
  column: KanbanColumn
  cards: KanbanCard[]
  onRename: (title: string) => void
  onRemove: () => void
  onAddCard: () => void
  onEditCard: (card: KanbanCard) => void
  onRemoveCard: (card: KanbanCard) => void
  onOpenCard: (card: KanbanCard) => void
  /** A card was dropped on this column, before `beforeCardId` or at the end. */
  onDropCard: (cardId: string, beforeCardId?: string) => void
}

/** MIME type used to carry the dragged card id through the HTML5 drag & drop API. */
export const CARD_DRAG_TYPE = 'application/x-seed-kanban-card'

export function Column({
  column,
  cards,
  onRename,
  onRemove,
  onAddCard,
  onEditCard,
  onRemoveCard,
  onOpenCard,
  onDropCard,
}: Props) {
  const [over, setOver] = useState(false)

  const allowDrop = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes(CARD_DRAG_TYPE)) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setOver(true)
  }

  const drop = (e: DragEvent, beforeCardId?: string) => {
    const cardId = e.dataTransfer.getData(CARD_DRAG_TYPE)
    if (!cardId) return
    e.preventDefault()
    e.stopPropagation()
    setOver(false)
    onDropCard(cardId, beforeCardId)
  }

  return (
    <section
      className={`column${over ? 'over' : ''}`}
      onDragOver={allowDrop}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => drop(e)}
    >
      <header className="column-header">
        <input
          className="column-title"
          value={column.title}
          onChange={(e) => onRename(e.target.value)}
          aria-label="Column title"
        />
        <span className="count">{cards.length}</span>
        <button className="icon" title="Delete column" onClick={onRemove}>
          ×
        </button>
      </header>
      <div className="cards">
        {cards.map((card) => (
          <Card
            key={card.id}
            card={card}
            onEdit={() => onEditCard(card)}
            onRemove={() => onRemoveCard(card)}
            onOpen={() => onOpenCard(card)}
            onDropBefore={(e) => drop(e, card.id)}
          />
        ))}
      </div>
      <button className="add-card" onClick={onAddCard}>
        + Add card
      </button>
    </section>
  )
}
