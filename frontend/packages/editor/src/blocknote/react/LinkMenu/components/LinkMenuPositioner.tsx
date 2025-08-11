import {
  BlockNoteEditor,
  BlockSchema,
  DefaultBlockSchema,
  LinkMenuProsemirrorPlugin,
  LinkMenuState,
} from '@/blocknote/core'
import Tippy from '@tippyjs/react'
import {FC, useEffect, useMemo, useRef, useState} from 'react'

import {LinkMenuItem} from '@/blocknote/core/extensions/LinkMenu/LinkMenuItem'
import {DefaultLinkMenu} from './DefaultLinkMenu'

export type LinkMenuProps<BSchema extends BlockSchema = DefaultBlockSchema> =
  Pick<LinkMenuProsemirrorPlugin<BSchema, any>, 'itemCallback'> &
    Pick<
      LinkMenuState<LinkMenuItem<BSchema>>,
      'items' | 'keyboardHoveredItemIndex'
    >

export const LinkMenuPositioner = <
  BSchema extends BlockSchema = DefaultBlockSchema,
>(props: {
  editor: BlockNoteEditor<BSchema>
  linkMenu?: FC<LinkMenuProps<BSchema>>
}) => {
  const [show, setShow] = useState<boolean>(false)
  const [ref, setRef] = useState<string>('')
  const [items, setItems] = useState<LinkMenuItem<BSchema>[]>([])
  const [keyboardHoveredItemIndex, setKeyboardHoveredItemIndex] =
    useState<number>()
  const scroller = useRef<HTMLElement | null>(null)

  const referencePos = useRef<DOMRect>()
  useEffect(() => {
    setTimeout(() => {
      scroller.current = document.getElementById('scroll-page-wrapper')
    }, 100)
  }, [])

  useEffect(() => {
    return props.editor.linkMenu.onUpdate((linkMenuState) => {
      setShow(linkMenuState.show)
      // @ts-expect-error
      setRef(linkMenuState.ref)
      // @ts-ignore
      setItems(linkMenuState.items)
      setKeyboardHoveredItemIndex(linkMenuState.keyboardHoveredItemIndex)

      referencePos.current = linkMenuState.referencePos
    })
  }, [props.editor, props.editor.linkMenu])

  const getReferenceClientRect = useMemo(
    () => {
      if (!referencePos.current) {
        return undefined
      }

      const boundingRect = referencePos.current!
      return () => boundingRect as DOMRect
    },
    [referencePos.current], // eslint-disable-line
  )

  const linkMenuElement = useMemo(
    () => {
      if (keyboardHoveredItemIndex === undefined) {
        return null
      }

      const LinkMenu = props.linkMenu || DefaultLinkMenu

      return (
        <LinkMenu
          items={items}
          itemCallback={(item) => props.editor.linkMenu.itemCallback(item, ref)}
          keyboardHoveredItemIndex={keyboardHoveredItemIndex}
        />
      )
    },
    [
      keyboardHoveredItemIndex,
      props.editor.linkMenu,
      props.linkMenu,
      ref,
      items,
    ], // eslint-disable-line
  )

  return (
    <Tippy
      appendTo={scroller.current ?? document.body}
      content={linkMenuElement}
      getReferenceClientRect={getReferenceClientRect}
      interactive={true}
      visible={show}
      animation={'fade'}
      placement="bottom-start"
      // Enable built-in boundary detection
      // @ts-expect-error
      flipOnUpdate={true}
      // Prevent overflow by adjusting position
      popperOptions={{
        modifiers: [
          {
            name: 'preventOverflow',
            options: {
              boundary: 'viewport',
              padding: 8,
            },
          },
          {
            name: 'flip',
            options: {
              fallbackPlacements: [
                'top-start',
                'bottom-end',
                'top-end',
                'right-start',
                'left-start',
              ],
              boundary: 'viewport',
              padding: 8,
            },
          },
          {
            name: 'offset',
            options: {
              offset: [0, 4],
            },
          },
        ],
      }}
    />
  )
}
