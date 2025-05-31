import {
  BlockNoteEditor,
  BlockSchema,
  HyperlinkToolbarProps,
  useEditorSelectionChange,
} from '@/blocknote'
import {hmId, packHmId, unpackHmId} from '@shm/shared'
import {resolveHypermediaUrl} from '@shm/shared/resolve-hm'
import {Close} from '@shm/ui/icons'
import {Spinner} from '@shm/ui/spinner'
import {usePopoverState} from '@shm/ui/use-popover-state'
import {Check, Link, Unlink} from '@tamagui/lucide-icons'
import {useCallback, useEffect, useState} from 'react'
import {
  Button,
  Input,
  Popover,
  SizeTokens,
  Theme,
  Tooltip,
  XGroup,
  XStack,
} from 'tamagui'

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
    (url: string, text?: string, currentUrl?: string) => {
      if (currentUrl) {
        deleteLink()
      }
      popoverProps.onOpenChange(false)
      props.editor.focus()
      props.editor.createLink(url, text)
    },
    [props.editor],
  )

  const deleteLink = () => {
    const url = props.editor.getSelectedLinkUrl()
    if (url) {
      const {view} = props.editor._tiptapEditor
      const {state} = view
      const $urlPos = state.doc.resolve(state.selection.from)
      const linkMarks = $urlPos.parent.firstChild!.marks
      if (linkMarks && linkMarks.length > 0) {
        const linkMark = linkMarks.find((mark) => mark.type.name == 'link')
        view.dispatch(
          view.state.tr
            .removeMark($urlPos.start(), $urlPos.end(), linkMark)
            .setMeta('preventAutolink', true),
        )
        view.focus()
      }
    }
  }

  return (
    <XGroup.Item>
      <Popover placement="top-end" open={open} {...popoverProps}>
        <Theme>
          <XGroup.Item>
            <Tooltip content="Link (Mod+K)">
              <Popover.Trigger asChild>
                <Button
                  height="100%"
                  size={props.size}
                  background={open ? '$color11' : 'transparent'}
                  color={open ? '$background' : undefined}
                  icon={Link}
                  borderRadius="$3"
                  hoverStyle={{backgroundColor: open ? '$color9' : '$color4'}}
                />
              </Popover.Trigger>
            </Tooltip>
          </XGroup.Item>
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
                setLink(_url, text, url)
              } else {
                setLink(_url, text)
              }
            }}
            onCancel={() => popoverProps.onOpenChange(false)}
            deleteHyperlink={deleteLink}
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
  const [isLoading, setIsLoading] = useState<boolean>(false)

  const inputLink = useCallback((url: string) => {
    try {
      setIsLoading(true)
      resolveHypermediaUrl(url)
        .then((resolved) => {
          console.log('resolved', resolved)
          if (resolved) {
            const baseId = unpackHmId(resolved.id)
            if (!baseId) return
            const u = new URL(url)
            const latest = u.searchParams.get('l')
            const blockRef = u.hash?.slice(1)
            const id = hmId(baseId.type, baseId.uid, {
              path: baseId.path,
              latest: latest === '',
            })
            const finalUrl = `${packHmId(id)}${blockRef ? `#${blockRef}` : ''}`
            setLink(finalUrl)
          } else {
            setLink(url.startsWith('http') ? url : `https://${url}`)
          }
        })
        .catch((e) => {
          setLink(url)
        })
        .finally(() => {
          setIsLoading(false)
        })
    } catch (e) {
      setLink(url.startsWith('http') ? url : `https://${url}`)
      setIsLoading(false)
    }
  }, [])

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
            inputLink(_url)
          }
        }}
        flex={1}
      />

      <XGroup borderRadius="$4">
        <XGroup.Item>
          {isLoading ? (
            <Spinner size="small" />
          ) : (
            <Button
              size="$2"
              bg="$color4"
              icon={Check}
              disabled={!_url}
              borderRadius={0}
              onClick={() => {
                inputLink(_url)
              }}
            />
          )}
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
