import {InlineMentionsResult} from '@shm/shared/models/inline-mentions'
import {useDebounce} from '@shm/shared/utils/use-debounce'
import {Button} from '@shm/ui/button'
import {SizableText} from '@shm/ui/text'
import {cn} from '@shm/ui/utils'
import {Fragment, NodeSpec} from '@tiptap/pm/model'
import {Decoration, DecorationSet} from '@tiptap/pm/view'
import {keymap} from 'prosemirror-keymap'
import {NodeSelection, Plugin, PluginKey} from 'prosemirror-state'
import React, {
  MouseEventHandler,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {keyboardStack, useKeyboard} from './keyboard-helpers'

export const autocompletePluginKey = new PluginKey('inline-embed')

export function createAutoCompletePlugin<N extends string, T>(args: {
  nodeName: N
  triggerCharacter: string
  renderPopup: (
    state: AutocompleteTokenPluginState<T>,
    actions: AutocompleteTokenPluginActions,
  ) => void
}): {plugins: Array<Plugin>; nodes: {[key in N]: NodeSpec}} {
  const {nodeName, triggerCharacter, renderPopup} = args
  const dataAttr = `data-${nodeName}`

  // this is the node that will be rendered in the editor
  const autocompleteTokenNode: NodeSpec = {
    priority: 1000,
    group: 'inline',
    inline: true,
    atom: true,
    attrs: {[nodeName]: {default: ''}},
    toDOM: (node) => {
      const span = document.createElement('span')
      const nodeAttr = node.attrs[nodeName]
      span.setAttribute(dataAttr, nodeAttr)
      return span
    },
    parseDOM: [
      {
        tag: `span[${dataAttr}]`,
        getAttrs: (dom) => {
          if (dom instanceof HTMLElement) {
            var value = dom.getAttribute(dataAttr)
            return {[nodeName]: value}
          }
          return false
        },
      },
    ],
  }

  const autocompleteTokenPlugin = new Plugin<AutocompleteTokenPluginState<T>>({
    priority: 1000,
    key: autocompletePluginKey,
    state: {
      init() {
        return {active: false}
      },
      apply(tr, state) {
        const action: AutocompleteTokenPluginAction | undefined = tr.getMeta(
          autocompletePluginKey,
        )

        if (action) {
          // this controls if we need to open the suggestions popup or not
          if (action.type == 'open') {
            const {pos, rect} = action
            const newState: AutocompleteTokenPluginState<T> = {
              active: true,
              range: {from: pos, to: pos},
              text: '',
              rect: rect,
            }
            return newState
          } else if (action.type === 'close') {
            return {active: false}
          }
        }

        // Update the range and compute query.
        if (state.active) {
          const {range} = state
          const from =
            range.from === range.to ? range.from : tr.mapping.map(range.from)
          const to = tr.mapping.map(range.to)

          const text = tr.doc.textBetween(from, to, '\n', '\0')
          if (!text.startsWith(triggerCharacter)) {
            // Close when deleting the #.
            return {active: false}
          }

          const queryText = text.slice(1) // Remove the leading "#" (triggerCharacter)
          const newState: AutocompleteTokenPluginState<T> = {
            ...state,
            range: {from, to},
            text: queryText,
          }
          return newState
        }

        return {active: false}
      },
    },
    props: {
      handleKeyDown(view, e) {
        const state = autocompletePluginKey.getState(view.state)

        if (state.active && keyboardStack.handleKeyDown(e)) {
          e.preventDefault()
          return true
        }

        const dispatch = (action: AutocompleteTokenPluginAction) => {
          view.dispatch(view.state.tr.setMeta(autocompletePluginKey, action))
        }

        // if key is #, check that the previous position is blank and the next position is blank.
        if (e.key === triggerCharacter) {
          const tr = view.state.tr
          var selection = tr.selection
          // Collapsed selection
          if (selection.from === selection.to) {
            const $position = selection.$from
            const isStart = $position.pos === $position.start()
            const isEnd = $position.pos === $position.end()
            const emptyPrev = Boolean(
              !isStart &&
                $position.doc
                  .textBetween($position.pos - 1, $position.pos, '\n', '\0')
                  .match(/\s/),
            )
            const emptyNext = Boolean(
              !isEnd &&
                $position.doc
                  .textBetween($position.pos, $position.pos + 1, '\n', '\0')
                  .match(/\s/),
            )

            // TODO: testing if letting add mentions anywhere feels better
            if ((isStart || emptyPrev) && (isEnd || emptyNext)) {
              const pos = $position.pos
              const rect = view.coordsAtPos(pos)
              dispatch({type: 'open', pos, rect})

              // Don't override the actual input.
              return false
            }
          }
        }

        return false
      },
      handleClick(view) {
        const state = autocompletePluginKey.getState(view.state)

        if (state.active) {
          view.dispatch(
            view.state.tr.setMeta(autocompletePluginKey, {type: 'close'}),
          )
        }
      },
      decorations(editorState) {
        const state: AutocompleteTokenPluginState<T> =
          autocompletePluginKey.getState(editorState)
        if (!state.active) {
          return null
        }
        const {range} = state
        return DecorationSet.create(editorState.doc, [
          Decoration.inline(range.from, range.to, {
            nodeName: 'span',
            style: 'color:#999;',
          }),
        ])
      },
    },
    view() {
      return {
        update(view) {
          var state: AutocompleteTokenPluginState<T> =
            autocompletePluginKey.getState(view.state)

          const onCreate = (
            link: string,
            range: {from: number; to: number},
          ) => {
            const node = view.state.schema.nodes[nodeName].create({
              link,
            })
            view.dispatch(
              view.state.tr.replaceWith(
                range.from,
                range.to,
                Fragment.fromArray([node, view.state.schema.text(' ')]),
              ),
            )
          }

          const dispatch = (action: AutocompleteTokenPluginAction) => {
            view.dispatch(view.state.tr.setMeta(autocompletePluginKey, action))
          }
          const onClose = () => dispatch({type: 'close'})

          renderPopup(state, {onCreate, onClose})
        },
      }
    },
  })

  const addContentBeforeInlineMentionPlugin = new Plugin({
    props: {
      handleKeyDown(view, event) {
        if (view.state.selection.from == view.state.selection.to) {
          // selection is collapsed
          const resolved = view.state.doc.resolve(view.state.selection.from)

          if (
            resolved &&
            resolved.nodeBefore == null &&
            resolved.nodeAfter?.type.name == 'inline-embed' &&
            event.code == `Key${event.key.toUpperCase()}`
          ) {
            // the cursor is collapsed and before the first node of a paragraph that is a 'inline-embed'
            view.dispatch(view.state.tr.insertText(event.key))
            return true
          }

          return false
        }
      },
    },
  })

  return {
    nodes: {[nodeName]: autocompleteTokenNode} as any,
    plugins: [
      addContentBeforeInlineMentionPlugin,
      autocompleteTokenPlugin,
      keymap({
        Backspace: (state, dispatch) => {
          const {node} = state.selection as NodeSelection
          if (node) {
            node.type == state.schema.nodes[nodeName]
            if (dispatch) {
              dispatch(state.tr.deleteSelection())
            }
            return true
          }
          return false
        },
      }),
    ],
  }
}

export function AutocompletePopup(props: {
  state: AutocompleteTokenPluginState<string>
  actions: AutocompleteTokenPluginActions
  editor: any
}) {
  if (!props.state.active) {
    return null
  }

  return (
    <AutocompletePopupInner
      editor={props.editor}
      {...props.state}
      {...props.actions}
    />
  )
}

const popupHeight = 160

function AutocompletePopupInner(
  props: AutocompleteTokenPluginActiveState<string> &
    AutocompleteTokenPluginActions & {
      editor: any
    },
) {
  const {rect, text, onClose, range, onCreate, editor} = props
  const debouncedText = useDebounce(text, 250)
  const [index, setIndex] = useState<[keyof InlineMentionsResult, number]>([
    'Recents',
    0,
  ])
  const [suggestions, setSuggestions] = useState<InlineMentionsResult>({
    Recents: [],
    Sites: [],
    Documents: [],
    Contacts: [],
  })

  const [position, setPosition] = useState<'above' | 'below'>('below')

  useEffect(() => {
    const viewportHeight = window.innerHeight

    const spaceBelow = viewportHeight - rect.bottom
    const spaceAbove = rect.top

    if (spaceBelow < popupHeight && spaceAbove > popupHeight) {
      setPosition('above')
    } else {
      setPosition('below')
    }
  }, [rect])

  useEffect(() => {
    let isActive = true

    editor.options
      .onMentionsQuery(debouncedText)
      .then((results: InlineMentionsResult) => {
        if (!isActive) return

        console.log('~~ MENTIONS RESULTS', results)

        setSuggestions((prev) => ({
          ...prev,
          ...results,
        }))

        if (isOptionsEmpty(results) && debouncedText.length > 5) {
          onClose()
        }
      })

    return () => {
      isActive = false
    }
  }, [debouncedText])

  useEffect(() => {
    const firstGroup = groups.find((g) => suggestions[g].length > 0)
    if (firstGroup) {
      setIndex([firstGroup, 0])
    }
  }, [suggestions])

  const groupsOrder = ['Contacts', 'Recents', 'Sites', 'Documents'] as const
  const groups = useMemo(() => {
    return groupsOrder.filter(
      (g) => suggestions.hasOwnProperty(g) && suggestions[g].length,
    )
  }, [suggestions])

  // console.log('groups', groups)

  useKeyboard({
    ArrowUp: (e) => {
      e.preventDefault()
      let [group, idx] = index
      if (idx == 0) {
        if (groups.indexOf(group) == 0) {
          // need to go to the end of the list
          setIndex([
            groups[groups.length - 1],
            groups[groups.length - 1].length - 1,
          ])
        } else {
          let groupIdx = strangle(groups.indexOf(group) - 1, [
            0,
            groupsOrder.length - 1,
          ])
          setIndex([groups[groupIdx], suggestions[groups[groupIdx]].length - 1])
        }
      } else {
        setIndex([group, idx - 1])
      }
      return true
      // }
    },
    ArrowDown: (e) => {
      e.preventDefault()
      let [group, idx] = index
      if (
        groups.indexOf(group) == groups.length - 1 &&
        idx == suggestions[group].length - 1
      ) {
        setIndex([groups[0], 0])
      } else if (idx < suggestions[group].length - 1) {
        setIndex([group, idx + 1])
      } else {
        let groupIdx = strangle(groups.indexOf(group) + 1, [
          0,
          groups.length - 1,
        ])

        setIndex([groups[groupIdx], 0])
      }
      return true
    },
    Enter: (e) => {
      e.preventDefault()
      let [group, idx] = index

      if (
        groups.indexOf(group) < groups.length &&
        idx < suggestions[group].length
      ) {
        let item = suggestions[group][idx]

        onCreate(item.value, range)
        onClose()
      }
      return true
    },
    Escape: (e) => {
      e.preventDefault()
      onClose()
      return true
    },
  })

  const topValue = position === 'below' ? rect.bottom + 4 : undefined
  const bottomValue =
    position === 'above'
      ? window.innerHeight - rect.top + popupHeight
      : undefined

  return (
    <div
      style={{
        position: 'fixed',
        top: topValue,
        bottom: bottomValue,
        left: rect.left,
        zIndex: 9999,
      }}
    >
      <div
        style={{
          position: 'fixed',
          width: '100vw',
          height: '100vh',
          top: 0,
          left: 0,
        }}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onClose()
        }}
      />
      <div className="border-muted bg-background absolute z-[9999] flex max-h-[10em] w-[20em] flex-col overflow-y-auto rounded border shadow-lg">
        {/* <div>Query: "{text}"</div> */}
        {isOptionsEmpty(suggestions) && (
          <div className="flex gap-2 bg-white px-4 py-2 dark:bg-black">
            <SizableText size="sm" className="flex-1">
              No Results
            </SizableText>
          </div>
        )}
        {groups.map((group) => {
          if (suggestions[group] && suggestions[group].length) {
            return (
              <div
                className="border-border flex flex-col last:border-b-0"
                key={group}
              >
                <div className="flex gap-2 bg-white px-4 py-2 dark:bg-black">
                  <SizableText size="sm" className="flex-1">
                    {group}
                  </SizableText>
                  {suggestions[group].length >= 1 ? (
                    <SizableText size="xs">
                      {suggestions[group].length == 1
                        ? '1 item'
                        : suggestions[group].length > 1
                        ? `${suggestions[group].length} items`
                        : ''}
                    </SizableText>
                  ) : null}
                </div>
                {suggestions[group].map((item, i) => {
                  let [currentGroup, idx] = index
                  return (
                    <SuggestionItem
                      selected={currentGroup == group && idx == i}
                      value={item.value}
                      key={`${group}-${item.value}`}
                      title={item.title}
                      subtitle={item.subtitle}
                      onMouseEnter={() => {
                        setIndex([group, i])
                      }}
                      onPress={() => {
                        onCreate(item.value, range)
                        onClose()
                      }}
                    />
                  )
                })}
              </div>
            )
          }
          return null
        })}
      </div>
    </div>
  )
}

function strangle(n: number, minMax: [number, number]) {
  // The function strangle takes a number 'n' and an array 'minMax' containing two numbers.
  // It returns the number 'n' if it is within the range specified by 'minMax'.
  // If 'n' is less than the first number in 'minMax', it returns the first number.
  // If 'n' is greater than the second number in 'minMax', it returns the second number.
  // Essentially, it "strangles" the number 'n' to ensure it stays within the specified range.
  const lowerBound = minMax[0] // The minimum value 'n' can be
  const upperBound = minMax[1] // The maximum value 'n' can be

  // If 'n' is less than the lowerBound, return lowerBound.
  // If 'n' is greater than the upperBound, return upperBound.
  // Otherwise, return 'n' as it is within the range.
  return Math.max(lowerBound, Math.min(n, upperBound))
}

export type AutocompleteTokenPluginState<T> =
  | {active: false}
  | AutocompleteTokenPluginActiveState<T>

export type AutocompleteTokenPluginActiveState<T> = {
  active: true
  // The cursor selection where we get text from
  range: {from: number; to: number}
  // The text we use to search
  text: string
  // Where to position the popup
  rect: {top: number; bottom: number; left: number}
}

export type AutocompleteTokenPluginActions = {
  onCreate: (link: string, range: {from: number; to: number}) => void
  onClose: () => void
}

export type AutocompleteTokenPluginAction =
  | {
      type: 'open'
      pos: number
      rect: {top: number; bottom: number; left: number}
    }
  | {type: 'close'}

const SuggestionItem = React.memo(function SuggestionItem(props: {
  value?: string
  title: string
  subtitle: string
  selected: boolean
  onPress: MouseEventHandler<HTMLButtonElement>
  onMouseEnter: MouseEventHandler<HTMLButtonElement>
}) {
  const elm = useRef<HTMLDivElement | null>(null)

  useLayoutEffect(() => {
    if (props.selected) {
      console.log(elm.current)
      elm.current?.scrollIntoView({block: 'nearest'})
    }
  }, [props.selected])

  if (!props.value && !props.title) {
    return null
  }

  return (
    <div ref={elm}>
      <Button
        onClick={props.onPress}
        onMouseEnter={props.onMouseEnter}
        variant={props.selected ? 'brand-12' : 'ghost'}
        size="sm"
        className={cn(
          'min-h-[28px] w-full justify-start px-3 py-1.5',
          props.selected && 'bg-brand-11 hover:bg-brand-11 text-white',
        )}
      >
        <SizableText
          size="sm"
          className="flex-1 p-0 text-left font-normal"
          color="default"
        >
          {props.title}
        </SizableText>
        <SizableText className="p-0" size="xs" color="default">
          {props.subtitle}
        </SizableText>
      </Button>
    </div>
  )
})

function isOptionsEmpty(obj: InlineMentionsResult) {
  return Object.values(obj).every((value) => value.length === 0)
}
