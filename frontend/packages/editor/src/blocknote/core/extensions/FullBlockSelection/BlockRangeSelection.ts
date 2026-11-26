import {Node, ResolvedPos} from 'prosemirror-model'
import {Selection, SelectionBookmark, TextSelection} from 'prosemirror-state'
import {Mappable} from 'prosemirror-transform'

/**
 * A range selected in reading order. It's a text selection which ends can sit at
 * the edges of blocks instead of in text.
 */
export class BlockRangeSelection extends TextSelection {
  override map(doc: Node, mapping: Mappable): Selection {
    const [anchor, head] = mapEnds(mapping, this.anchor, this.head)
    return rangeSelectionBetween(doc.resolve(anchor), doc.resolve(head))
  }

  override getBookmark(): BlockRangeBookmark {
    return new BlockRangeBookmark(this.anchor, this.head)
  }
}

/** Restores a {@link BlockRangeSelection} after undo and redo, which map selections through a bookmark. */
class BlockRangeBookmark implements SelectionBookmark {
  constructor(
    readonly anchor: number,
    readonly head: number,
  ) {}

  map(mapping: Mappable): BlockRangeBookmark {
    const [anchor, head] = mapEnds(mapping, this.anchor, this.head)
    return new BlockRangeBookmark(anchor, head)
  }

  resolve(doc: Node): Selection {
    const clamp = (pos: number) => Math.max(0, Math.min(pos, doc.content.size))
    return rangeSelectionBetween(doc.resolve(clamp(this.anchor)), doc.resolve(clamp(this.head)))
  }
}

/**
 * Maps both ends so each stays on its side of the range: the start sticks to what follows it and the end to what
 * precedes it.
 */
function mapEnds(mapping: Mappable, anchor: number, head: number): [number, number] {
  const forward = anchor <= head
  return [mapping.map(anchor, forward ? -1 : 1), mapping.map(head, forward ? 1 : -1)]
}

/**
 * The range between two ends, as the simplest selection that holds it: a cursor when they meet, a plain text selection
 * when both are in text, and a {@link BlockRangeSelection} when either sits at a block's edge.
 */
export function rangeSelectionBetween($anchor: ResolvedPos, $head: ResolvedPos): Selection {
  // The edit removed everything in between.
  if ($anchor.pos === $head.pos) return Selection.near($head)
  // Both ends in text is an ordinary text selection.
  if ($anchor.parent.inlineContent && $head.parent.inlineContent) return new TextSelection($anchor, $head)
  return new BlockRangeSelection($anchor, $head)
}
