import {useOpenUrl} from '@/open-url'
import {
  Block,
  BlockNoteEditor,
  createReactBlockSpec,
  defaultProps,
} from '@shm/editor/blocknote'
import {isValidUrl} from '@shm/editor/utils'
import {TwitterXIcon} from '@shm/ui/icons'
import {Spinner} from '@shm/ui/spinner'
import {Fragment} from '@tiptap/pm/model'
import {useEffect, useRef, useState} from 'react'
import {SizableText, useTheme, YStack} from 'tamagui'
import {MediaContainer} from './media-container'
import {DisplayComponentProps, MediaRender, MediaType} from './media-render'
import {HMBlockSchema} from './schema'

export const WebEmbed = createReactBlockSpec({
  type: 'web-embed',
  propSchema: {
    ...defaultProps,
    url: {
      default: '',
    },
    defaultOpen: {
      values: ['false', 'true'],
      default: 'false',
    },
  },
  containsInlineContent: true,

  render: ({
    block,
    editor,
  }: {
    block: Block<HMBlockSchema>
    editor: BlockNoteEditor<HMBlockSchema>
  }) => Render(block, editor),

  parseHTML: [
    {
      tag: 'div[data-content-type=web-embed]',
      priority: 1000,
      getContent: (_node, _schema) => {
        return Fragment.empty
      },
    },
  ],
})

const Render = (
  block: Block<HMBlockSchema>,
  editor: BlockNoteEditor<HMBlockSchema>,
) => {
  const theme = useTheme()

  const submitTwitterLink = (url: string, assign: any, setFileName: any) => {
    if (isValidUrl(url)) {
      if (url.includes('twitter') || url.includes('x.com')) {
        assign({props: {url: url}} as MediaType)
      } else {
        setFileName({
          name: `The provided URL is not a twitter URL`,
          color: 'red',
        })
        return
      }
    } else setFileName({name: 'The provided URL is invalid.', color: 'red'})
    const cursorPosition = editor.getTextCursorPosition()
    editor.focus()
    if (cursorPosition.block.id === block.id) {
      if (cursorPosition.nextBlock)
        editor.setTextCursorPosition(cursorPosition.nextBlock, 'start')
      else {
        editor.insertBlocks(
          [{type: 'paragraph', content: ''}],
          block.id,
          'after',
        )
        editor.setTextCursorPosition(
          editor.getTextCursorPosition().nextBlock!,
          'start',
        )
      }
    }
  }
  return (
    <MediaRender
      block={block}
      hideForm={!!block.props.url}
      editor={editor}
      mediaType="web-embed"
      submit={submitTwitterLink}
      DisplayComponent={display}
      icon={<TwitterXIcon fill={theme.color12.get()} />}
    />
  )
}

const display = ({
  editor,
  block,
  selected,
  setSelected,
  assign,
}: DisplayComponentProps) => {
  const urlArray = block.props.url.split('/')
  const xPostId = urlArray[urlArray.length - 1].split('?')[0]
  const openUrl = useOpenUrl()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)

  // const iframeRef = useRef(null)

  // useEffect(() => {
  //   const handleResize = (event: MessageEvent) => {
  //     if (
  //       event.origin === 'https://platform.twitter.com' &&
  //       iframeRef.current
  //     ) {
  //       const {height} = event.data
  //       console.log(height, event.data)
  //       iframeRef.current.style.height = `${height}px`
  //     }
  //   }

  const containerRef = useRef(null)
  const isInitialized = useRef(false)
  const scriptId = 'twitter-widgets-script'
  const createdTweets = useRef(new Set())

  let scriptLoadPromise: Promise<any> | null = null

  const loadTwitterScript = () => {
    // Check if the script was already added to the document
    const script = document.getElementById(scriptId) as HTMLScriptElement | null

    if (scriptLoadPromise) {
      return scriptLoadPromise
    }

    if (script && window.twttr) {
      // If the script is loaded and window.twttr is ready, resolve immediately
      return Promise.resolve(window.twttr)
    }

    // If the script exists but window.twttr is not ready, wait for it
    if (script) {
      scriptLoadPromise = new Promise((resolve) => {
        const checkTwttr = setInterval(() => {
          if (window.twttr) {
            clearInterval(checkTwttr)
            resolve(window.twttr)
          }
        }, 50) // Retry every 50 ms
      })
      return scriptLoadPromise
    }

    // Load the script
    scriptLoadPromise = new Promise((resolve) => {
      const newScript = document.createElement('script')
      newScript.id = scriptId
      newScript.src = 'https://platform.twitter.com/widgets.js'
      newScript.async = true
      newScript.onload = () => resolve(window.twttr)
      document.body.appendChild(newScript)
    })

    return scriptLoadPromise
  }

  useEffect(() => {
    const initializeTweet = async () => {
      const twttr = await loadTwitterScript()
      if (!isInitialized.current && twttr) {
        if (!createdTweets.current.has(block.id)) {
          createdTweets.current.add(block.id)
          const result = await twttr.widgets.createTweet(
            xPostId,
            containerRef.current,
            {
              theme: 'dark',
              align: 'center',
            },
          )
          isInitialized.current = true
          if (!result) setError(true)
        }
      }
    }

    setLoading(true)
    initializeTweet()
      .then(() => {
        setLoading(false)
      })
      .catch((err) => {
        console.error('Error initializing tweet:', err)
        setLoading(false)
      })

    return () => {
      isInitialized.current = false
    }
  }, [block.props.url])

  return (
    <MediaContainer
      editor={editor}
      block={block}
      mediaType="web-embed"
      selected={selected}
      setSelected={setSelected}
      assign={assign}
      onPress={() => {
        openUrl(block.props.link)
      }}
      styleProps={{
        padding: '$3',
        overflow: 'hidden',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto',
        fontWeight: '400',
      }}
      // className="x-post-container"
    >
      {/* <iframe
        // ref={iframeRef}
        src={`https://platform.twitter.com/embed/index.html?id=${xPostId}&theme=dark`}
        width="100%" // Set width to be responsive
        height="auto"
        style={{border: 'none', overflow: 'hidden'}}
      ></iframe> */}
      {loading && <Spinner />}
      {error && (
        <YStack p="$7" ai="center" ac="center">
          <SizableText
            color="$red11"
            p="$1"
            // borderWidth="$1.5"
            // borderRadius="$3"
            // borderColor="$color8"
          >
            Error loading tweet, please check the tweet ID!
          </SizableText>
        </YStack>
      )}
      <div ref={containerRef} />
    </MediaContainer>
  )
}
