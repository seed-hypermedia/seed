import {
  Button,
  Check,
  Close,
  Input,
  Link,
  Popover,
  SizeTokens,
  Theme,
  Tooltip,
  Unlink,
  XGroup,
  XStack,
} from '@shm/ui'
import {useCallback, useEffect, useState} from 'react'
import {usePopoverState} from '../use-popover-state'
import {
  BlockNoteEditor,
  BlockSchema,
  HyperlinkToolbarProps,
  useEditorSelectionChange,
} from './blocknote'

export const HMLinkToolbarButton = <BSchema extends BlockSchema>(props: {
  editor: BlockNoteEditor<BSchema>
  size: SizeTokens
}) => {
  const [url, setUrl] = useState<string>(
    props.editor.getSelectedLinkUrl() || '',
  )
  const [text, setText] = useState<string>(props.editor.getSelectedText() || '')

  const {open, ...popoverProps} = usePopoverState()

  useEditorSelectionChange(props.editor, () => {
    setText(props.editor.getSelectedText() || '')
    setUrl(props.editor.getSelectedLinkUrl() || '')
  })

  useEffect(() => {
    props.editor.hyperlinkToolbar.on('update', (state) => {
      setText(state.text || '')
      setUrl(state.url || '')
    })
  }, [props.editor])

  const setLink = useCallback(
    (url: string, text?: string) => {
      popoverProps.onOpenChange(false)
      props.editor.focus()
      props.editor.createLink(url, text)
    },
    [props.editor],
  )

  return (
    <XGroup.Item>
      <Popover placement="top-end" open={open} {...popoverProps}>
        <Theme inverse={open}>
          <Popover.Trigger asChild>
            <Button
              size="$3"
              icon={Link}
              bg={'$backgroundFocus'}
              borderRadius={0}
            />
          </Popover.Trigger>
        </Theme>
        <Popover.Content
          p="$1"
          elevation="$4"
          borderColor="$color4"
          borderWidth="$1"
        >
          <AddHyperlink
            url={url}
            setLink={(_url: string) => {
              popoverProps.onOpenChange(false)
              props.editor.focus()
              if (url) {
                props.editor.hyperlinkToolbar.updateHyperlink(_url, text)
              } else {
                setLink(_url, text)
              }
            }}
            onCancel={() => popoverProps.onOpenChange(false)}
            deleteHyperlink={props.editor.hyperlinkToolbar.deleteHyperlink}
          />
        </Popover.Content>
      </Popover>
    </XGroup.Item>
  )
}

function AddHyperlink({
  setLink,
  onCancel,
  url = '',
  deleteHyperlink,
}: {
  setLink: (url: string) => void
  onCancel: () => void
  url?: string
} & Partial<HyperlinkToolbarProps>) {
  const [_url, setUrl] = useState<string>(url)

  return (
    <XStack elevation="$4" padding="$2" borderRadius="$4" space>
      <Input
        value={_url}
        onChangeText={setUrl}
        minWidth="15rem"
        size="$2"
        bg="$color4"
        borderWidth={0}
        placeholder="Enter a link"
        onKeyPress={(e: KeyboardEvent) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            setLink(_url)
          }
        }}
        flex={1}
      />

      <XGroup borderRadius="$4">
        <XGroup.Item>
          <Button
            size="$2"
            bg="$color4"
            icon={Check}
            disabled={!_url}
            borderRadius={0}
            onClick={() => {
              setLink(_url)
            }}
          />
        </XGroup.Item>

        <XGroup.Item>
          <Tooltip content="Delete Link" placement="top">
            <Button
              size="$2"
              bg="$color4"
              icon={Unlink}
              onPress={deleteHyperlink}
              borderRadius={0}
            />
          </Tooltip>
        </XGroup.Item>

        <XGroup.Item>
          <Button size="$2" bg="$color4" icon={Close} onPress={onCancel} />
        </XGroup.Item>
      </XGroup>
    </XStack>
  )
}
