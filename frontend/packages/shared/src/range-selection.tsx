import {useMachine} from '@xstate/react'
import React, {useEffect, useMemo, useRef, useState} from 'react'
import {assign, setup} from 'xstate'
import {isSurrogate} from './client/unicode'
import {HMBlockNode} from './hm-types'

/**
 * Converts a UTF-16 offset to a Unicode codepoint offset
 * @param text - The source text (HMBlock.text with invisible characters)
 * @param utf16Offset - The UTF-16 based offset from browser selection
 * @returns The corresponding Unicode codepoint offset
 */
function utf16ToCodepointOffset(text: string, utf16Offset: number): number {
  let codepointOffset = 0
  let utf16Index = 0

  while (utf16Index < utf16Offset && utf16Index < text.length) {
    if (isSurrogate(text, utf16Index)) {
      // Surrogate pair takes 2 UTF-16 code units but counts as 1 codepoint
      utf16Index += 2
    } else {
      // Regular character takes 1 UTF-16 code unit and counts as 1 codepoint
      utf16Index += 1
    }
    codepointOffset++
  }

  return codepointOffset
}

function getBlockNodeById(
  blocks: Array<HMBlockNode>,
  blockId: string,
): HMBlockNode | null {
  if (!blockId) return null

  let res: HMBlockNode | undefined
  blocks.find((bn) => {
    if (bn.block?.id == blockId) {
      res = bn
      return true
    } else if (bn.children?.length) {
      const foundChild = getBlockNodeById(bn.children, blockId)
      if (foundChild) {
        res = foundChild
        return true
      }
    }
    return false
  })
  return res || null
}

const defaultContext = {
  selection: null,
  blockId: '',
  rangeStart: null,
  rangeEnd: null,
  mouseDown: false,
}

type MachineContext = {
  selection: Selection | null
  blockId: string
  rangeStart: number | null
  rangeEnd: number | null
  expanded: boolean
  mouseDown: boolean
}

type MachineEvents =
  | {type: 'SELECT'}
  | {type: 'CREATE_COMMENT'}
  | {type: 'COMMENT_CANCEL'}
  | {type: 'COMMENT_SUBMIT'}
  | {type: 'MOUSEDOWN'}
  | {type: 'MOUSEUP'}
  | {type: 'ENABLE'}
  | {type: 'DISABLE'}

const rangeSelectionMachine = setup({
  types: {
    context: {} as MachineContext,
    events: {} as MachineEvents,
  },
  actions: {
    setMouse: assign(({context, event}) => {
      return {
        ...context,
        mouseDown: event.type == 'MOUSEDOWN',
      }
    }),
    setRange: () => {},
    clearContext: assign(() => {
      document.getSelection()?.empty()
      return defaultContext
    }),
  },
}).createMachine({
  context: {
    selection: null,
    blockId: '',
    rangeStart: null,
    rangeEnd: null,
    expanded: false,
    mouseDown: false,
  },
  id: 'Range Selection',
  initial: 'disable',
  on: {
    ENABLE: {
      target: '.idle',
    },
    DISABLE: {
      target: '.disable',
    },
    MOUSEDOWN: {
      actions: ['setMouse'],
    },
    MOUSEUP: {
      actions: ['setMouse'],
    },
  },
  states: {
    disable: {},
    idle: {
      on: {
        SELECT: {
          target: 'active',
        },
      },
    },
    active: {
      initial: 'selecting',
      states: {
        selecting: {
          after: {
            '300': {
              target: 'selected',
              guard: ({context}) => !context.mouseDown,
            },
          },
          on: {
            SELECT: {
              target: 'selecting',
              reenter: true,
            },
            MOUSEUP: {
              target: 'selected',
            },
          },
        },
        selected: {
          entry: ['setRange'],
          on: {
            SELECT: {
              target: 'selecting',
              action: ['clearContext'],
            },
            CREATE_COMMENT: {
              target: '#Range Selection.idle',
              actions: ['clearContext'],
            },
          },
        },
        commenting: {
          on: {
            COMMENT_SUBMIT: {
              target: '#Range Selection.idle',
            },
            COMMENT_CANCEL: {
              target: 'selected',
            },
          },
        },
      },
    },
  },
})

export function useRangeSelection(documentContent?: Array<HMBlockNode>): {
  state: any
  send: any
  actor: any
  coords: {top: number; left: number}
  wrapper: React.RefObject<HTMLDivElement>
  bubble: React.RefObject<HTMLDivElement>
} {
  const machine = useMemo(
    () =>
      rangeSelectionMachine.provide({
        actions: {
          setRange: assign(() => {
            let sel = window.getSelection()

            if (sel && sel.rangeCount > 0) {
              const {anchorNode, anchorOffset, focusNode, focusOffset} = sel
              const anchorBlockId = getParentElId(anchorNode)
              const focusBlockId = getParentElId(focusNode)
              const anchorRangeOffset = getRangeOffset(anchorNode)
              const focusRangeOffset = getRangeOffset(focusNode)

              // Check for triple-click: when all offsets are 0 and we have selected text
              const isTripleClick =
                anchorOffset === 0 &&
                focusOffset === 0 &&
                anchorRangeOffset === 0 &&
                focusRangeOffset === 0 &&
                sel.toString().length > 0

              if (isTripleClick && anchorBlockId) {
                // Handle triple-click: select entire anchor block
                if (documentContent) {
                  const blockNode = getBlockNodeById(
                    documentContent,
                    anchorBlockId,
                  )
                  if (
                    blockNode?.block &&
                    'text' in blockNode.block &&
                    blockNode.block.text
                  ) {
                    const blockText = blockNode.block.text
                    return {
                      ...defaultContext,
                      selection: sel,
                      blockId: anchorBlockId,
                      rangeStart: 0,
                      rangeEnd: utf16ToCodepointOffset(
                        blockText,
                        blockText.length,
                      ),
                      expanded: false,
                    }
                  }
                }
                // Fallback to DOM text if documentContent not available
                const blockElement = document.getElementById(anchorBlockId)
                if (blockElement) {
                  const blockTextContent = blockElement.textContent || ''
                  return {
                    ...defaultContext,
                    selection: sel,
                    blockId: anchorBlockId,
                    rangeStart: 0,
                    rangeEnd: blockTextContent.length,
                    expanded: false,
                  }
                }
              }

              if (focusBlockId !== anchorBlockId) {
                // Check if this is a triple-click scenario (all offsets are 0 and text is selected)
                const isTripleClick =
                  anchorOffset === 0 &&
                  focusOffset === 0 &&
                  anchorRangeOffset === 0 &&
                  focusRangeOffset === 0 &&
                  sel.toString().length > 0

                if (isTripleClick && anchorBlockId) {
                  // Handle triple-click: select entire anchor block
                  if (documentContent) {
                    const blockNode = getBlockNodeById(
                      documentContent,
                      anchorBlockId,
                    )
                    if (
                      blockNode?.block &&
                      'text' in blockNode.block &&
                      blockNode.block.text
                    ) {
                      const blockText = blockNode.block.text
                      return {
                        ...defaultContext,
                        selection: sel,
                        blockId: anchorBlockId,
                        rangeStart: 0,
                        rangeEnd: utf16ToCodepointOffset(
                          blockText,
                          blockText.length,
                        ),
                      }
                    }
                  }
                  // Fallback to DOM text if documentContent not available
                  const blockElement = document.getElementById(anchorBlockId)
                  if (blockElement) {
                    const blockTextContent = blockElement.textContent || ''
                    return {
                      ...defaultContext,
                      selection: sel,
                      blockId: anchorBlockId,
                      rangeStart: 0,
                      rangeEnd: blockTextContent.length,
                    }
                  }
                }

                // For any other multi-block selection, reject it
                return defaultContext
              }

              const blockId = focusBlockId
              const anchorRange = anchorRangeOffset + anchorOffset
              const focusRange = focusRangeOffset + focusOffset

              if (anchorRange === focusRange) {
                return defaultContext
              }

              const utf16RangeStart = Math.min(anchorRange, focusRange)
              const utf16RangeEnd = Math.max(anchorRange, focusRange)

              // Convert UTF-16 offsets to Unicode codepoint offsets
              let rangeStart = utf16RangeStart
              let rangeEnd = utf16RangeEnd

              if (documentContent && blockId) {
                const blockNode = getBlockNodeById(documentContent, blockId)
                if (
                  blockNode?.block &&
                  'text' in blockNode.block &&
                  blockNode.block.text
                ) {
                  const blockText = blockNode.block.text
                  rangeStart = utf16ToCodepointOffset(
                    blockText,
                    utf16RangeStart,
                  )
                  rangeEnd = utf16ToCodepointOffset(blockText, utf16RangeEnd)
                }
              }

              return {
                ...defaultContext,
                selection: sel,
                blockId,
                rangeStart,
                rangeEnd,
              }
            }
            return defaultContext
          }),
        },
      }),
    [documentContent],
  )

  const [state, send, actor] = useMachine(machine)
  const wrapper = useRef<HTMLDivElement>(null)
  const bubble = useRef<HTMLDivElement>(null)
  const [coords, setCoords] = useState({
    top: 0,
    left: 0,
  })

  useEffect(() => {
    if (
      wrapper.current &&
      bubble.current &&
      state.matches({active: 'selected'}) &&
      state.context.selection &&
      state.context.selection.rangeCount > 0
    ) {
      const wrapperRect = wrapper.current.getBoundingClientRect()
      const bubbleRect = bubble.current.getBoundingClientRect()

      const range = state.context.selection.getRangeAt(0)
      const rect = range.getBoundingClientRect()

      setCoords({
        top: rect.top - wrapperRect.top - (bubbleRect.height + 8),

        left:
          rect.left + rect.width / 2 - wrapperRect.left - bubbleRect.width / 2,
      })
    } else {
      setCoords({top: -9999, left: -9999})
    }
  }, [
    wrapper.current,
    state.matches({active: 'selected'}),
    state.context.selection,
  ])

  useEffect(function rangeSelectionEffect() {
    document.addEventListener('selectionchange', handleSelectionChange)
    wrapper.current?.addEventListener('mousedown', handleMouseDown(true))
    wrapper.current?.addEventListener('touchstart', handleMouseDown(true))
    wrapper.current?.addEventListener('mouseup', handleMouseDown(false))
    wrapper.current?.addEventListener('touchend', handleMouseDown(false))

    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange)
      wrapper.current?.removeEventListener('mousedown', handleMouseDown(true))
      wrapper.current?.removeEventListener('touchstart', handleMouseDown(true))
      wrapper.current?.removeEventListener('mouseup', handleMouseDown(false))
      wrapper.current?.removeEventListener('touchend', handleMouseDown(false))
    }

    function handleSelectionChange() {
      if (wrapper.current) {
        const selection = window.getSelection()
        if (
          selection &&
          wrapper.current.contains(selection.anchorNode) &&
          wrapper.current.contains(selection.focusNode)
        ) {
          actor.send({type: 'SELECT'})
        } else {
        }
      } else {
      }
    }

    function handleMouseDown(mouseDown: boolean) {
      return function handleMouseDown() {
        actor.send({type: mouseDown ? 'MOUSEDOWN' : 'MOUSEUP'})
      }
    }
  }, [])

  return {
    state,
    send,
    actor,
    coords,
    wrapper,
    bubble,
  }
}

function getParentElId(el: Node | null) {
  if (!el) return null
  // @ts-expect-error
  if (el.id) return el.id
  if (!el.parentElement) return null
  return getParentElId(el.parentElement)
}

function getRangeOffset(el: Node | null) {
  if (!el) return 0
  // @ts-expect-error
  if (el.dataset?.rangeOffset != null) return Number(el.dataset?.rangeOffset)
  if (!el.parentElement) return 0
  return getRangeOffset(el.parentElement)
}
