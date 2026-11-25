import {useHideOnDocumentScroll} from '@shm/shared/models/use-document-machine'
import Tippy from '@tippyjs/react'
import type {Instance as TippyInstance} from 'tippy.js'
import {FC, useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {
  BaseUiElementState,
  BlockNoteEditor,
  BlockSchema,
  DefaultBlockSchema,
  HyperlinkToolbarProsemirrorPlugin,
  HyperlinkToolbarState,
} from '../../../core'

import {HMBlockSchema} from '../../../../schema'
import {DefaultHyperlinkToolbar} from './DefaultHyperlinkToolbar'

export type HyperlinkToolbarProps = Pick<
  HyperlinkToolbarProsemirrorPlugin<any>,
  'deleteHyperlink' | 'updateHyperlink' | 'resetHyperlink'
> &
  Omit<HyperlinkToolbarState, keyof BaseUiElementState> & {
    editor: BlockNoteEditor<HMBlockSchema>
    onChangeLink: any
  }

export const HyperlinkToolbarPositioner = <BSchema extends BlockSchema = DefaultBlockSchema>(props: {
  openUrl: (url?: string | undefined, newWindow?: boolean | undefined) => void
  editor: BlockNoteEditor<BSchema>
  hyperlinkToolbar?: FC<HyperlinkToolbarProps>
}) => {
  const [show, setShow] = useState<boolean>(false)
  const [url, setUrl] = useState<string>()
  const [text, setText] = useState<string>()
  const [type, setType] = useState<string>()
  const [id, setId] = useState<string>()
  const [toolbarProps, setToolbarProps] = useState<HyperlinkToolbarState['props']>()

  const referencePos = useRef<DOMRect>()
  const tippyInstance = useRef<TippyInstance>()
  const buttonBlockId = useRef<string>()

  useEffect(() => {
    return props.editor.hyperlinkToolbar!.on('update', (hyperlinkToolbarState) => {
      setShow(hyperlinkToolbarState.show)
      setUrl(hyperlinkToolbarState.url)
      setText(hyperlinkToolbarState.text)
      setType(hyperlinkToolbarState.type)
      setId(hyperlinkToolbarState.id)
      setToolbarProps(hyperlinkToolbarState.props)

      referencePos.current = hyperlinkToolbarState.referencePos
      buttonBlockId.current = hyperlinkToolbarState.type === 'button' ? hyperlinkToolbarState.id : undefined
    })
  }, [props.editor])

  useHideOnDocumentScroll(() => setShow(false))

  const getReferenceClientRect = useCallback(() => {
    // Measure the button position live to rerender the menu in a correct position immediatelly.
    const liveButton = buttonBlockId.current ? findButtonFace(props.editor.domElement, buttonBlockId.current) : null
    return liveButton?.getBoundingClientRect() ?? referencePos.current ?? new DOMRect()
  }, [props.editor])

  // Follow the button while the toolbar is open. The whole editor is
  // watched because updating a block can replace its DOM element.
  useEffect(() => {
    if (!show || type !== 'button') return
    const observer = new MutationObserver(() => tippyInstance.current?.popperInstance?.update())
    observer.observe(props.editor.domElement, {attributes: true, childList: true, subtree: true})
    return () => observer.disconnect()
  }, [show, type, props.editor])

  const estimatedFormHeight = 400
  const isTop = useMemo(() => {
    if (!referencePos.current) return false
    const spaceBelow = window.innerHeight - referencePos.current.bottom
    return spaceBelow < estimatedFormHeight
  }, [show])

  const hyperlinkToolbarElement = useMemo(() => {
    if (!type || !id) {
      return null
    }

    const HyperlinkToolbar = props.hyperlinkToolbar || DefaultHyperlinkToolbar

    return (
      <HyperlinkToolbar
        url={url ?? ''}
        text={text ?? ''}
        updateHyperlink={props.editor.hyperlinkToolbar!.updateHyperlink}
        deleteHyperlink={props.editor.hyperlinkToolbar!.deleteHyperlink}
        resetHyperlink={props.editor.hyperlinkToolbar!.resetHyperlink}
        onChangeLink={(key: 'url' | 'text', value: string) => {
          if (key == 'text') {
            setText(value)
          } else {
            setUrl(value)
          }
        }}
        openUrl={props.openUrl}
        stopEditing={!show}
        // @ts-ignore
        editor={props.editor}
        // @ts-expect-error
        type={type}
        id={id}
        toolbarProps={toolbarProps}
      />
    )
  }, [props.hyperlinkToolbar, props.editor, text, url, show, toolbarProps, id])

  return (
    <Tippy
      onCreate={(instance) => {
        tippyInstance.current = instance
      }}
      appendTo={props.editor.domElement.parentElement ?? document.body}
      // onHidden={() => setIsEditing(false)}
      content={hyperlinkToolbarElement}
      getReferenceClientRect={getReferenceClientRect}
      interactive={true}
      visible={show}
      animation={'fade'}
      placement={isTop ? 'top' : 'bottom'}
      popperOptions={{
        strategy: 'fixed',
        modifiers: [
          {
            name: 'flip',
            enabled: true,
            options: {
              fallbackPlacements: [isTop ? 'bottom' : 'top'],
              padding: 8,
            },
          },
          {
            name: 'preventOverflow',
            options: {
              boundary: 'viewport',
              rootBoundary: 'viewport',
              tether: false,
              altAxis: true,
              padding: 8,
            },
          },
          {name: 'offset', options: {offset: [0, 8]}},
          {
            name: 'computeStyles',
            options: {adaptive: true, gpuAcceleration: false},
          },
        ],
      }}
    />
  )
}

function findButtonFace(editorElement: HTMLElement, blockId: string): HTMLElement | null {
  return editorElement.querySelector<HTMLElement>(`[id="${CSS.escape(blockId)}"] [data-content-type="button"] button`)
}
