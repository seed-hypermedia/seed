import {BlockNoteEditor} from '@/blocknote/core/BlockNoteEditor'
import {Block} from '@/blocknote/core/extensions/Blocks/api/blockTypes'
import {defaultProps} from '@/blocknote/core/extensions/Blocks/api/defaultBlocks'
import {createReactBlockSpec} from '@/blocknote/react/ReactBlockSpec'
import {MediaContainer} from '@/media-container'
import {DisplayComponentProps, MediaRender, MediaType} from '@/media-render'
import {HMBlockSchema} from '@/schema'
import {isValidUrl} from '@/utils'
import {
  generateInstagramEmbedHtml,
  loadInstagramScript,
  loadTwitterScript,
} from '@shm/shared/utils/web-embed-scripts'
import {TwitterXIcon} from '@shm/ui/icons'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {YStack} from '@tamagui/stacks'
import {Fragment} from '@tiptap/pm/model'
import {useEffect, useRef, useState} from 'react'
import {useTheme} from 'tamagui'
import {useDocContentContext} from '../../ui/src/document-content'

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

  const submitWebEmbedLink = (url: string, assign: any, setFileName: any) => {
    if (!isValidUrl(url)) {
      setFileName({name: 'The provided URL is invalid.', color: 'red'})
      return
    }

    if (
      !url.includes('twitter') &&
      !url.includes('x.com') &&
      !url.includes('instagram.com')
    ) {
      setFileName({
        name: 'Only Twitter/X and Instagram embeds are supported.',
        color: 'red',
      })
      return
    }

    assign({props: {url: url}} as MediaType)

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
      submit={submitWebEmbedLink}
      DisplayComponent={display}
      icon={<TwitterXIcon fill={theme.color12?.get()} />}
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
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const {openUrl} = useDocContentContext()

  const containerRef = useRef(null)
  const isInitialized = useRef(false)

  const url = block.props.url
  const isTwitter = /(?:twitter\.com|x\.com)/.test(url)
  const isInstagram = /instagram\.com/.test(url)
  const tweetId = url.split('/').pop()?.split('?')[0]

  const createdTweets = useRef(new Set())

  useEffect(() => {
    const initEmbed = async () => {
      setLoading(true)
      try {
        if (isTwitter) {
          const twttr = await loadTwitterScript()
          if (!isInitialized.current && twttr && containerRef.current) {
            if (!createdTweets.current.has(block.id)) {
              createdTweets.current.add(block.id)
              const result = await twttr.widgets.createTweet(
                tweetId!,
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
        } else if (isInstagram) {
          if (containerRef.current) {
            containerRef.current.innerHTML = generateInstagramEmbedHtml(url)
            loadInstagramScript()
            setTimeout(() => {
              // Retry to process embed
              try {
                ;(window as any).instgrm?.Embeds?.process()
              } catch (e) {
                console.error('Instagram embed error:', e)
                setError(true)
              }
            }, 300)
          }
        } else {
          setError(true)
        }
      } catch (err) {
        console.error('Web Embed load error:', err)
        setError(true)
      } finally {
        setLoading(false)
      }
    }

    initEmbed()

    return () => {
      isInitialized.current = false
    }
  }, [url])

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
    >
      {/* <iframe
        // ref={iframeRef}
        src={`https://platform.twitter.com/embed/index.html?id=${xPostId}&theme=dark`}
        width="100%" // Set width to be responsive
        height="auto"
        style={{border: 'none', overflow: 'hidden'}}
      ></iframe> */}
      {loading && (
        <div className="flex items-center justify-center">
          <Spinner />
        </div>
      )}
      {error && (
        <YStack padding="$7" alignItems="center" alignContent="center">
          <SizableText color="destructive" className="p-1">
            Error loading embed, please check the link!
          </SizableText>
        </YStack>
      )}
      <div
        ref={containerRef}
        style={{
          display: 'flex',
          justifyContent: 'center',
          width: '100%',
        }}
      />
    </MediaContainer>
  )
}
