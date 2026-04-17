/**
 * Drag-and-drop state machine for block-level drags.
 *
 * Pure reducer pattern — no side effects, no external deps.
 * The DragStateManager wraps the reducer with subscriber notifications.
 */

// ---------------------------------------------------------------------------
// Drop instruction types
// ---------------------------------------------------------------------------

export type DropInstruction =
  | {type: 'reorder-above'; targetBlockId: string; level: number}
  | {type: 'reorder-below'; targetBlockId: string; level: number}
  | {type: 'make-child'; targetBlockId: string}
  | {type: 'reparent'; targetBlockId: string; desiredLevel: number}
  | {type: 'grid-before'; targetBlockId: string}
  | {type: 'grid-after'; targetBlockId: string}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type DragState =
  | {type: 'idle'}
  | {type: 'previewing'; sourceBlockIds: string[]}
  | {type: 'dragging'; sourceBlockIds: string[]; instruction: DropInstruction | null}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type DragAction =
  | {type: 'PREVIEW'; sourceBlockIds: string[]}
  | {type: 'START'}
  | {type: 'UPDATE_INSTRUCTION'; instruction: DropInstruction | null}
  | {type: 'DROP'}
  | {type: 'CANCEL'}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function dragReducer(state: DragState, action: DragAction): DragState {
  switch (state.type) {
    case 'idle': {
      if (action.type === 'PREVIEW') {
        return {type: 'previewing', sourceBlockIds: action.sourceBlockIds}
      }
      return state
    }
    case 'previewing': {
      if (action.type === 'START') {
        return {type: 'dragging', sourceBlockIds: state.sourceBlockIds, instruction: null}
      }
      if (action.type === 'CANCEL') {
        return {type: 'idle'}
      }
      return state
    }
    case 'dragging': {
      if (action.type === 'UPDATE_INSTRUCTION') {
        return {...state, instruction: action.instruction}
      }
      if (action.type === 'DROP' || action.type === 'CANCEL') {
        return {type: 'idle'}
      }
      return state
    }
  }
}

// ---------------------------------------------------------------------------
// Manager (wraps reducer + subscriber pattern for React)
// ---------------------------------------------------------------------------

type Listener = () => void

export class DragStateManager {
  private state: DragState = {type: 'idle'}
  private listeners = new Set<Listener>()

  getState = (): DragState => {
    return this.state
  }

  dispatch = (action: DragAction): void => {
    const prev = this.state
    const next = dragReducer(prev, action)
    if (prev !== next) {
      this.state = next
      this.listeners.forEach((l) => l())
    }
  }

  /** Compatible with React's useSyncExternalStore */
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}
