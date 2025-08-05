import {useMachine} from '@xstate/react'
import {useEffect, useRef, useState} from 'react'
import {assign, setup} from 'xstate'

export function useRangeSelection() {
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

    function handleSelectionChange(e: any) {
      if (wrapper.current) {
        const selection = window.getSelection()
        if (
          selection &&
          wrapper.current.contains(selection.anchorNode) &&
          wrapper.current.contains(selection.focusNode)
        ) {
          actor.send({type: 'SELECT'})
        }
      }
    }

    function handleMouseDown(mouseDown: boolean) {
      return function handleMouseDown(e: any) {
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

const defaultContext = {
  selection: null,
  blockId: '',
  rangeStart: null,
  rangeEnd: null,
  mouseDown: false,
}

const machine = setup({
  types: {
    context: defaultContext as {
      selection: Selection | null
      blockId: string
      rangeStart: number | null
      rangeEnd: number | null
      mouseDown: boolean
    },
    events: {} as
      | {type: 'SELECT'}
      | {type: 'CREATE_COMMENT'}
      | {type: 'COMMENT_CANCEL'}
      | {type: 'COMMENT_SUBMIT'}
      | {type: 'MOUSEDOWN'}
      | {type: 'MOUSEUP'}
      | {type: 'ENABLE'}
      | {type: 'DISABLE'},
  },
  actions: {
    setMouse: assign(({context, event}) => {
      return {
        ...context,
        mouseDown: event.type == 'MOUSEDOWN',
      }
    }),
    // @ts-expect-error
    setRange: assign(() => {
      let sel = window.getSelection()
      if (sel && sel.rangeCount > 0) {
        const {anchorNode, anchorOffset, focusNode, focusOffset} = sel
        const anchorBlockId = getParentElId(anchorNode)
        const focusBlockId = getParentElId(focusNode)
        const anchorRangeOffset = getRangeOffset(anchorNode)
        const focusRangeOffset = getRangeOffset(focusNode)

        if (focusBlockId !== anchorBlockId) {
          // Check if this is a triple-click scenario (all offsets are 0)
          const isTripleClick = focusRangeOffset === 0 && focusOffset === 0

          if (isTripleClick && anchorBlockId) {
            // Handle triple-click: select entire anchor block
            // console.log(
            //   '=== SELECTION === Triple-click detected, selecting entire block:',
            //   anchorBlockId,
            // )
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
          // console.log(
          //   '=== SELECTION === invalid selection, multiple blocks selected.',
          //   {
          //     anchorBlockId,
          //     focusBlockId,
          //     anchorRangeOffset,
          //     focusRangeOffset,
          //     anchorOffset,
          //     focusOffset,
          //   },
          // )
          return defaultContext
        }
        const blockId = focusBlockId
        const anchorRange = anchorRangeOffset + anchorOffset
        const focusRange = focusRangeOffset + focusOffset
        if (anchorRange === focusRange) {
          // console.log('=== SELECTION === empty range not supported')
          return defaultContext
        }
        const rangeStart = Math.min(anchorRange, focusRange)
        const rangeEnd = Math.max(anchorRange, focusRange)

        console.log('=== SELECTION === ', {
          blockId,
          rangeStart,
          rangeEnd,
        })
        return {
          ...defaultContext,
          selection: sel,
          blockId,
          rangeStart,
          rangeEnd,
        }
      }
    }),
    clearContext: assign(() => {
      document.getSelection()?.empty()
      return defaultContext
    }),
  },
  // schemas: {
  //   events: {
  //     SELECT: {
  //       type: 'object',
  //       properties: {},
  //     },
  //     CREATE_COMMENT: {
  //       type: 'object',
  //       properties: {},
  //     },
  //     COMMENT_CANCEL: {
  //       type: 'object',
  //       properties: {},
  //     },
  //     COMMENT_SUBMIT: {
  //       type: 'object',
  //       properties: {},
  //     },
  //   },
  // },
}).createMachine({
  context: {
    selection: null,
    blockId: '',
    rangeStart: null,
    rangeEnd: null,
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
              // target: 'commenting',
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

function getParentElId(el: Node | null) {
  if (!el) return null
  // @ts-expect-error - this is a HTMLElement but TS says Node
  if (el.id) return el.id
  if (!el.parentElement) return null
  return getParentElId(el.parentElement)
}

function getRangeOffset(el: Node | null) {
  if (!el) return 0
  // @ts-expect-error - this is a HTMLElement but TS says Node
  if (el.dataset?.rangeOffset != null) return Number(el.dataset?.rangeOffset)
  if (!el.parentElement) return 0
  return getRangeOffset(el.parentElement)
}
