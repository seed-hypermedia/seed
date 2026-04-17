/**
 * React overlay component that renders the drop indicator line
 * during block drags. Subscribes to DragStateManager via useSyncExternalStore.
 */
import {useSyncExternalStore} from 'react'
import type {DragStateManager, DropInstruction} from '../../../core/extensions/SideMenu/drag-state'

const INDICATOR_COLOR = '#2684FF'
const INDICATOR_THICKNESS = 2
const INDENT_PER_LEVEL = 24

export function DropIndicator({stateManager}: {stateManager: DragStateManager}) {
  const state = useSyncExternalStore(stateManager.subscribe, stateManager.getState)

  if (state.type !== 'dragging' || !state.instruction) {
    return null
  }

  return <IndicatorLine instruction={state.instruction} />
}

function IndicatorLine({instruction}: {instruction: DropInstruction}) {
  const targetEl = document.querySelector(`[data-id="${instruction.targetBlockId}"]`) as HTMLElement | null
  if (!targetEl) return null

  const rect = targetEl.getBoundingClientRect()

  // Find the content area (first child = block content node) to get
  // the correct width. The blockNode element itself can be wider than
  // the visible content area.
  const contentEl = targetEl.firstElementChild as HTMLElement | null
  const contentRect = contentEl ? contentEl.getBoundingClientRect() : rect

  const style = computeIndicatorStyle(instruction, rect, contentRect)
  if (!style) return null

  return (
    <div
      style={{
        position: 'fixed',
        pointerEvents: 'none',
        zIndex: 9999,
        backgroundColor: INDICATOR_COLOR,
        borderRadius: 1,
        transition: 'all 60ms ease',
        ...style,
      }}
    >
      {/* Circle at the leading edge */}
      <div
        style={{
          position: 'absolute',
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: INDICATOR_COLOR,
          ...circlePosition(instruction, style),
        }}
      />
    </div>
  )
}

function computeIndicatorStyle(
  instruction: DropInstruction,
  rect: DOMRect,
  contentRect: DOMRect,
): React.CSSProperties | null {
  // Use the content area's left + width to constrain the indicator
  const left = contentRect.left
  const width = contentRect.width

  switch (instruction.type) {
    case 'reorder-above':
      return {
        top: rect.top - INDICATOR_THICKNESS / 2,
        left,
        width,
        height: INDICATOR_THICKNESS,
      }

    case 'reorder-below':
      return {
        top: rect.bottom - INDICATOR_THICKNESS / 2,
        left,
        width,
        height: INDICATOR_THICKNESS,
      }

    case 'make-child':
      return {
        top: rect.bottom - INDICATOR_THICKNESS / 2,
        left: left + INDENT_PER_LEVEL,
        width: width - INDENT_PER_LEVEL,
        height: INDICATOR_THICKNESS,
      }

    case 'reparent': {
      const outdent = Math.max(0, instruction.desiredLevel - 1) * INDENT_PER_LEVEL
      const reparentLeft = left - outdent
      return {
        top: rect.bottom - INDICATOR_THICKNESS / 2,
        left: Math.max(0, reparentLeft),
        width: width + (left - Math.max(0, reparentLeft)),
        height: INDICATOR_THICKNESS,
      }
    }

    case 'grid-before':
      return {
        top: rect.top,
        left: rect.left - INDICATOR_THICKNESS / 2,
        width: INDICATOR_THICKNESS,
        height: rect.height,
      }

    case 'grid-after':
      return {
        top: rect.top,
        left: rect.right - INDICATOR_THICKNESS / 2,
        width: INDICATOR_THICKNESS,
        height: rect.height,
      }
  }
}

function circlePosition(instruction: DropInstruction, style: React.CSSProperties): React.CSSProperties {
  const isVertical = instruction.type === 'grid-before' || instruction.type === 'grid-after'

  if (isVertical) {
    return {
      top: -3,
      left: -3,
    }
  }

  return {
    top: -3,
    left: -3,
  }
}
