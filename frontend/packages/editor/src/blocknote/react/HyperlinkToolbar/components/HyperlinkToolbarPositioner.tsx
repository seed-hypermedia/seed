import Tippy from '@tippyjs/react'
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
  | 'deleteHyperlink'
  | 'startHideTimer'
  | 'stopHideTimer'
  | 'updateHyperlink'
  | 'resetHyperlink'
> &
  Omit<HyperlinkToolbarState, keyof BaseUiElementState> & {
    editor: BlockNoteEditor<HMBlockSchema>
    onChangeLink: any
  }

export const HyperlinkToolbarPositioner = <
  BSchema extends BlockSchema = DefaultBlockSchema,
>(props: {
  openUrl: (url?: string | undefined, newWindow?: boolean | undefined) => void
  editor: BlockNoteEditor<BSchema>
  hyperlinkToolbar?: FC<HyperlinkToolbarProps>
}) => {
  const [show, setShow] = useState<boolean>(false)
  const [url, setUrl] = useState<string>()
  const [text, setText] = useState<string>()
  const [type, setType] = useState<string>()
  const [id, setId] = useState<string>()
  const [toolbarProps, setToolbarProps] =
    useState<HyperlinkToolbarState['props']>()

  const referencePos = useRef<DOMRect>()

  useEffect(() => {
    return props.editor.hyperlinkToolbar.on(
      'update',
      (hyperlinkToolbarState) => {
        setShow(hyperlinkToolbarState.show)
        setUrl(hyperlinkToolbarState.url)
        setText(hyperlinkToolbarState.text)
        setType(hyperlinkToolbarState.type)
        setId(hyperlinkToolbarState.id)
        setToolbarProps(hyperlinkToolbarState.props)

        referencePos.current = hyperlinkToolbarState.referencePos
      },
    )
  }, [props.editor])

  const getReferenceClientRect = useCallback(() => {
    return referencePos.current ?? new DOMRect()
  }, [])

  const hyperlinkToolbarElement = useMemo(() => {
    if (!type || !id) {
      return null
    }

    const HyperlinkToolbar = props.hyperlinkToolbar || DefaultHyperlinkToolbar

    return (
      <HyperlinkToolbar
        url={url ?? ''}
        text={text ?? ''}
        updateHyperlink={props.editor.hyperlinkToolbar.updateHyperlink}
        deleteHyperlink={props.editor.hyperlinkToolbar.deleteHyperlink}
        startHideTimer={props.editor.hyperlinkToolbar.startHideTimer}
        stopHideTimer={props.editor.hyperlinkToolbar.stopHideTimer}
        resetHyperlink={props.editor.hyperlinkToolbar.resetHyperlink}
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
        setHovered={(hovering: boolean) =>
          props.editor.hyperlinkToolbar.setToolbarHovered(hovering)
        }
        toolbarProps={toolbarProps}
      />
    )
  }, [props.hyperlinkToolbar, props.editor, text, url, show])

  return (
    <Tippy
      appendTo={props.editor.domElement.parentElement ?? document.body}
      // onHidden={() => setIsEditing(false)}
      content={hyperlinkToolbarElement}
      getReferenceClientRect={getReferenceClientRect}
      interactive={true}
      visible={show}
      animation={'fade'}
      placement={'bottom'}
      zIndex={99998}
    />
  )
}
