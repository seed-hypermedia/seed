import type {DragEvent} from 'react'
import type {KanbanCard} from '../board'
import {CARD_DRAG_TYPE} from './Column'

type Props = {
  card: KanbanCard
  onEdit: () => void
  onRemove: () => void
  onOpen: () => void
  onDropBefore: (e: DragEvent) => void
}

export function Card({card, onEdit, onRemove, onOpen, onDropBefore}: Props) {
  const startDrag = (e: DragEvent) => {
    e.dataTransfer.setData(CARD_DRAG_TYPE, card.id)
    e.dataTransfer.effectAllowed = 'move'
  }
  return (
    <article className="card" draggable onDragStart={startDrag} onDrop={onDropBefore} onDoubleClick={onEdit}>
      <div className="card-title">{card.title}</div>
      {card.note && <div className="card-note">{card.note}</div>}
      <div className="card-actions">
        {card.link && (
          <button className="link" title={card.link} onClick={onOpen}>
            Open
          </button>
        )}
        <button className="link" onClick={onEdit}>
          Edit
        </button>
        <button className="link danger" onClick={onRemove}>
          Delete
        </button>
      </div>
    </article>
  )
}
