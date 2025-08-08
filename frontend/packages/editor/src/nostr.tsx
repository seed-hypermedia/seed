import {
  Block,
  BlockNoteEditor,
  createReactBlockSpec,
  defaultProps,
  getBlockInfoFromPos,
} from '@shm/editor/blocknote'
import {DAEMON_FILE_UPLOAD_URL, DAEMON_FILE_URL} from '@shm/shared/constants'
import {Button} from '@shm/ui/button'
import {Input} from '@shm/ui/components/input'
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@shm/ui/components/tabs'
import {SizableText, Text} from '@shm/ui/text'
import {Tooltip} from '@shm/ui/tooltip'
import {cn} from '@shm/ui/utils'
import {
  Event as NostrEvent,
  nip19,
  nip21,
  relayInit,
  validateEvent,
  verifySignature,
} from 'nostr-tools'
import {useEffect, useState} from 'react'
import {HMBlockSchema} from './schema'

export const RELAY_LIST = [
  'wss://relayable.org',
  'wss://brb.io',
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://soloco.nl',
]

export const NostrBlock = createReactBlockSpec({
  type: 'nostr',
  propSchema: {
    ...defaultProps,
    name: {
      default: '',
    },
    url: {
      default: '',
    },
    text: {
      default: '',
    },
    size: {
      default: '',
    },
    defaultOpen: {
      values: ['false', 'true'],
      default: 'true',
    },
  },
  containsInlineContent: true,
  // @ts-ignore
  render: ({
    block,
    editor,
  }: {
    block: Block<HMBlockSchema>
    editor: BlockNoteEditor<HMBlockSchema>
  }) => Render(block, editor),
})

type NostrType = {
  id: string
  props: {
    url: string
    name: string
    text: string
    size: string
  }
  children: []
  content: []
  type: string
}

const boolRegex = new RegExp('true')

const Render = (
  block: Block<HMBlockSchema>,
  editor: BlockNoteEditor<HMBlockSchema>,
) => {
  const [selected, setSelected] = useState(false)
  const tiptapEditor = editor._tiptapEditor
  const selection = tiptapEditor.state.selection

  useEffect(() => {
    const selectedNode = getBlockInfoFromPos(
      tiptapEditor.state,
      tiptapEditor.state.selection.from,
    )
    if (selectedNode && selectedNode.block.node.attrs.id) {
      if (
        selectedNode.block.node.attrs.id === block.id &&
        selectedNode.block.beforePos === selection.$anchor.pos
      ) {
        setSelected(true)
      } else if (selectedNode.block.node.attrs.id !== block.id) {
        setSelected(false)
      }
    }
  }, [selection])

  const assignNostr = (newNostr: NostrType) => {
    editor.updateBlock(block.id, {
      props: {...block.props, ...newNostr.props},
      content: newNostr.content,
    })
    editor.setTextCursorPosition(block.id, 'end')
  }

  const setSelection = (isSelected: boolean) => {
    setSelected(isSelected)
  }

  return (
    <div className="flex flex-col overflow-hidden">
      {block.props.name ? (
        <NostrComponent
          block={block}
          editor={editor}
          assign={assignNostr}
          selected={selected}
          setSelected={setSelection}
        />
      ) : editor.isEditable ? (
        <NostrForm block={block} editor={editor} assign={assignNostr} />
      ) : null}
    </div>
  )
}

function NostrComponent({
  block,
  editor,
  assign,
  selected,
  setSelected,
}: {
  block: Block<HMBlockSchema>
  editor: BlockNoteEditor<HMBlockSchema>
  assign: any
  selected: boolean
  setSelected: any
}) {
  // @ts-expect-error
  const nostrNpud = nip19.npubEncode(block.props.name)

  const [replace, setReplace] = useState<boolean>(false)
  const [verified, setVerified] = useState<boolean>()
  const [content, setContent] = useState<string>()

  const uri = `nostr:${nostrNpud}`
  const header = `${nostrNpud.slice(0, 6)}...${nostrNpud.slice(-6)}`

  if (block.props.name && block.props.name !== '') {
    fetch(`${DAEMON_FILE_URL}/${block.props.url}`, {
      method: 'GET',
    }).then((response) => {
      if (response) {
        response.text().then((text) => {
          if (text) {
            const fileEvent = JSON.parse(text)
            if (content === undefined) setContent(fileEvent.content)
            if (verified === undefined && validateEvent(fileEvent)) {
              setVerified(verifySignature(fileEvent))
            }
          }
        })
      }
    })
  }

  return (
    <div
      // @ts-ignore
      contentEditable={false}
      className={`flex flex-col ${block.type}`}
      onMouseEnter={(e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
        setReplace(true)
      }}
      onMouseLeave={(e: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
        setReplace(false)
      }}
    >
      {replace && editor.isEditable ? (
        <Button
          className="absolute top-1.5 right-1.5 z-20 w-[60px]"
          size="sm"
          onClick={() =>
            assign({
              props: {
                url: '',
                name: '',
                size: '0',
                text: '',
              },
              children: [],
              content: [],
              type: 'file',
            } as NostrType)
          }
        >
          replace
        </Button>
      ) : null}
      <div className="flex">
        <div className="border-border flex-1 rounded-md border">
          <SizableText className="mt-2" size="2xl">
            <div className="flex justify-between">
              <Text>
                {'Public Key: '}
                {nip21.test(uri) ? <a href={uri}>{header}</a> : header}
              </Text>
              <Tooltip
                content={verified ? 'Signature verified' : 'Invalid signature'}
              >
                <Button
                  disabled
                  variant={
                    verified === undefined
                      ? 'blue'
                      : verified
                      ? 'green'
                      : 'orange'
                  }
                  size="sm"
                ></Button>
              </Tooltip>
            </div>
          </SizableText>
          <p className="mt-4">{content}</p>
        </div>
      </div>
    </div>
  )
}

function NostrForm({
  block,
  assign,
  editor,
}: {
  block: Block<HMBlockSchema>
  assign: any
  editor: BlockNoteEditor<HMBlockSchema>
}) {
  const [rawNote, setRawNote] = useState('')
  const [note, setNote] = useState<NostrEvent>()
  const [nevent, setNevent] = useState('')
  const [tabState, setTabState] = useState('search')
  const [state, setState] = useState<{
    name: string | undefined
    color: string | undefined
  }>({
    name: undefined,
    color: undefined,
  })

  useEffect(() => {
    if (note) ingestNote(note)
  }, [note])

  const delay = async (t = 100): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, t))
  }

  const searchRelay = async (
    relayUrl: string,
    noteId: string,
  ): Promise<void> => {
    const relay = relayInit(relayUrl)
    relay.on('connect', () => {
      setState({name: `Searching in ${relayUrl}`, color: 'green'})
    })
    relay.on('error', () => {
      throw new Error()
    })

    await relay.connect()

    await delay(1000)

    const sub = relay.sub([
      {
        ids: [noteId],
      },
    ])

    sub.on('event', async (event) => {
      if (event.id === noteId) {
        setNote(event)
        sub.unsub()
      }
    })
    sub.on('eose', () => {
      sub.unsub()
    })

    await delay(4000)

    if (!note) {
      sub.unsub()
      throw new Error()
    }
  }

  const searchNote = async () => {
    setState({name: 'Connecting...', color: 'green'})
    const decodedBech32 = nip19.decode(nevent)
    let noteId = ''
    let relayListIndex = 0
    let relays = RELAY_LIST.sort(() => Math.random() - 0.5)

    if (decodedBech32.type === 'nevent') {
      noteId = decodedBech32.data.id
      relays = [...(decodedBech32.data.relays ?? []), ...RELAY_LIST]
    } else if (decodedBech32.type === 'note') {
      noteId = decodedBech32.data
    }

    const tryRelay = async () => {
      // @ts-expect-error
      searchRelay(RELAY_LIST[relayListIndex], noteId).catch(() => {
        relayListIndex = relayListIndex + 1
        if (relayListIndex < RELAY_LIST.length) {
          tryRelay()
        } else {
          setState({name: "Can't find the note in relays.", color: 'red'})
        }
      })
    }

    if (noteId !== '') tryRelay()
  }

  const submitNote = async (raw: string = rawNote) => {
    const event: NostrEvent = JSON.parse(raw)
    setNote(event)
  }

  const isValidEvent = (event: NostrEvent) => {
    try {
      return validateEvent(event) && verifySignature(event)
    } catch (e) {
      console.log(JSON.stringify(e))
      return false
    }
  }

  const ingestNote = async (event: NostrEvent): Promise<void> => {
    if (isValidEvent(event)) {
      const blobData = [JSON.stringify(event)]
      const blob = new Blob(blobData, {type: 'text/plain'})

      const formData = new FormData()
      formData.append('file', blob, event.id)
      const response = await fetch(DAEMON_FILE_UPLOAD_URL, {
        method: 'POST',
        body: formData,
      })

      const data = await response.text()
      if (response.status !== 201) {
        throw new Error(data)
      }

      setState({name: undefined, color: undefined})
      assign({
        props: {
          url: data,
          name: event.id,
          text: event.content,
          size: blob.size,
        },
      })
    } else {
      setState({
        name: 'The provided note is invalid or not supported.',
        color: 'red',
      })
    }
  }

  return (
    <div
      className="border-border relative flex flex-col rounded border-[2.5px] outline-none"
      // @ts-ignore
      contentEditable={false}
    >
      <Tabs
        value={tabState}
        onValueChange={(value: string) => {
          setState({
            name: undefined,
            color: undefined,
          })
          setTabState(value)
        }}
        className="flex flex-col"
      >
        <TabsList className="border-muted bg-background mb-1 h-auto w-full rounded-none border-b p-0">
          <TabsTrigger
            value="search"
            className={cn(
              'h-auto flex-1 rounded-none border-b-0 bg-transparent px-4 py-2 text-sm font-medium hover:bg-black/5 data-[state=active]:shadow-none dark:hover:bg-white/10',
              tabState === 'search'
                ? 'border-foreground border-b'
                : 'border-b-0',
            )}
          >
            <SizableText size="sm">Search</SizableText>
          </TabsTrigger>
          <TabsTrigger
            value="manual"
            className={cn(
              'h-auto flex-1 rounded-none border-b-0 bg-transparent px-4 py-2 text-sm font-medium hover:bg-black/5 data-[state=active]:shadow-none dark:hover:bg-white/10',
              tabState === 'manual'
                ? 'border-foreground border-b'
                : 'border-b-0',
            )}
          >
            <SizableText size="sm">Manual</SizableText>
          </TabsTrigger>
        </TabsList>
        <TabsContent value="search">
          <div className="bg-background flex items-center rounded p-4">
            <form className="w-full" onSubmit={() => searchNote()}>
              <div className="flex flex-1 gap-3">
                <Input
                  className="w-full"
                  placeholder="Input nevent or note1"
                  onChange={(e) => setNevent(e.target.value)}
                  autoFocus={true}
                />

                <Button type="submit">SEARCH</Button>
              </div>
              {state.name && (
                <SizableText
                  size="sm"
                  style={{color: state.color}}
                  className="pt-2"
                >
                  {state.name}
                </SizableText>
              )}
            </form>
          </div>
        </TabsContent>
        <TabsContent value="manual">
          <div className="bg-background flex items-center rounded p-4">
            <form className="w-full" onSubmit={() => submitNote()}>
              <div className="flex flex-1 gap-3">
                <Input
                  className="w-full"
                  placeholder="Input JSON note"
                  onChange={(e) => setRawNote(e.target.value)}
                  autoFocus={true}
                />

                <Button type="submit">EMBED</Button>
              </div>
              {state.name && (
                <SizableText
                  size="sm"
                  style={{color: state.color}}
                  className="pt-2"
                >
                  {state.name}
                </SizableText>
              )}
            </form>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
