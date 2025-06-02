import type {
  AssistMessage,
  AssistThread,
  ListedAssistThread,
} from '@/app-assist'
import {useAppContext} from '@/app-context'
import {trpc} from '@/trpc'
import {useNavRoute} from '@/utils/navigation'
import {formattedDate, unpackHmId} from '@shm/shared'
import {useEntity} from '@shm/shared/models/entity'
import {Button} from '@shm/ui/button'
import {copyTextToClipboard} from '@shm/ui/copy-to-clipboard'
import {HoverCard} from '@shm/ui/hover-card'
import {Sparkles} from '@shm/ui/icons'
import {Spinner} from '@shm/ui/spinner'
import {Tooltip} from '@shm/ui/tooltip'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {usePopoverState} from '@shm/ui/use-popover-state'
import {
  ArrowLeft,
  ArrowRightCircle,
  Clipboard,
  FileQuestion,
  FileText,
  History,
  List,
} from '@tamagui/lucide-icons'
import {useEffect, useRef, useState} from 'react'
import {
  Input,
  Popover,
  SizableText,
  styled,
  Text,
  XStack,
  YStack,
} from 'tamagui'

export function AssistFooter() {
  const historyDialog = useAppDialog(AssistHistoryDialog, {
    contentProps: {width: '60vw', padding: 0},
  })
  const threadDialog = useAppDialog(AssistThreadDialog, {
    contentProps: {width: '60vw', padding: 0},
  })
  const settings = trpc.assist.getSettings.useQuery()
  if (!settings.data?.model || !settings.data?.provider) {
    return null
  }
  return (
    <>
      <AssistButton onThreadOpen={threadDialog.open} />
      <Tooltip content="Past assistant threads">
        <Button
          onPress={() => {
            historyDialog.open(true)
          }}
          icon={History}
          size="$1"
        ></Button>
      </Tooltip>
      {threadDialog.content}
      {historyDialog.content}
    </>
  )
}

function AssistButton({
  onThreadOpen,
}: {
  onThreadOpen: (input: {threadId: string}) => void
}) {
  const {ai} = useAppContext()
  const popover = usePopoverState()
  useEffect(() => {
    console.log('AssistButton popover state changed:', {open: popover.open})
  }, [popover.open])

  return (
    <>
      <Popover {...popover} placement="top-start">
        <Tooltip content="Ask me anything">
          <Popover.Trigger asChild>
            <Button icon={Sparkles} size="$1">
              Assist
            </Button>
          </Popover.Trigger>
        </Tooltip>
        <Popover.Content
          padding={0}
          backgroundColor="$background"
          borderWidth={1}
          borderColor="$borderColor"
          elevation="$4"
          enterStyle={{y: -10, opacity: 0}}
          exitStyle={{y: -10, opacity: 0}}
          elevate
          animation={[
            'fast',
            {
              opacity: {
                overshootClamping: true,
              },
            },
          ]}
        >
          <StartAssistForm
            onThreadOpen={(threadId) => {
              onThreadOpen(threadId)
              popover.onOpenChange(false)
            }}
          />
        </Popover.Content>
      </Popover>
    </>
  )
}

function StartAssistForm({
  onThreadOpen,
}: {
  onThreadOpen: (input: {threadId: string}) => void
}) {
  const {ai} = useAppContext()
  const route = useNavRoute()
  const [prompt, setPrompt] = useState('')
  const [isStarting, setIsStarting] = useState(false)

  function startAssist() {
    if (!prompt.trim() || isStarting) return
    console.log('startAssist', prompt)
    setIsStarting(true)
    ai
      ?.startThread({prompt, route})
      .then((threadId) => {
        console.log('threadId', threadId)
        setIsStarting(false)
        onThreadOpen({threadId})
      })
      .catch(() => {
        setIsStarting(false)
      })
  }
  return (
    <XStack>
      <Input
        value={prompt}
        onChangeText={setPrompt}
        onKeyPress={(e) => {
          if (e.nativeEvent.key === 'Enter' && !isStarting) {
            startAssist()
          }
        }}
        placeholder="How can I help?"
        autoFocus
        disabled={isStarting}
      />
      {isStarting ? (
        <Spinner position="absolute" right="$2" top="$2" size="small" />
      ) : (
        <Button
          position="absolute"
          right="$2"
          size="$2"
          top="$2"
          onPress={startAssist}
          icon={ArrowRightCircle}
          disabled={!prompt.trim()}
        />
      )}
    </XStack>
  )
}

export function AssistThreadDialog({
  input,
  onClose,
}: {
  input: {threadId: string}
  onClose: () => void
}) {
  return <AssistThreadView threadId={input.threadId} />
}

export function AssistThreadView({threadId}: {threadId: string}) {
  const {ai} = useAppContext()
  const [thread, setThread] = useState<AssistThread | null>(null)
  useEffect(() => {
    ai?.getThread(threadId).then((thread) => {
      setThread({
        ...thread,
        messages: thread.messages.filter(
          (message) => message.role !== 'system',
        ),
      })
    })
  }, [threadId])
  useEffect(() => {
    const unsubscribe = ai?.subscribeThread(threadId, (message) => {
      console.log('assist message', threadId, message)
      if (message.role === 'assistant' && message.content === '') {
        return
      }
      setThread((thread) => {
        if (!thread) return thread
        return {
          ...thread,
          messages: [
            ...thread.messages.filter((m) => m.id !== message.id),
            message,
          ],
        }
      })
    })
    return () => unsubscribe?.()
  }, [ai, threadId])

  return (
    <YStack minHeight="$20" alignSelf="stretch" maxHeight="100%">
      <YStack
        flex={1}
        maxHeight="calc(100vh - 400px)"
        padding="$3"
        gap="$3"
        overflow="scroll"
      >
        {thread?.messages.map((message, index) => (
          <AssistMessageItem key={message.id} message={message} />
        ))}
      </YStack>

      <ThreadMessageForm threadId={threadId} />
    </YStack>
  )
}

function getToolTitle(toolName: string | undefined) {
  switch (toolName) {
    case undefined:
      return 'Unknown'
    case 'readDocument':
      return 'Read Document'
    case 'listDocuments':
      return 'List Documents'
    default:
      return toolName
  }
}

function getToolIcon(toolName: string | undefined) {
  switch (toolName) {
    case undefined:
      return FileQuestion
    case 'readDocument':
      return FileText
    case 'listDocuments':
      return List
  }
  return FileQuestion
}

function ToolReadDocumentPresentation({message}: {message: AssistMessage}) {
  const docIdStr = message.toolRequest?.documentId
  const docId = docIdStr ? unpackHmId(docIdStr) : null
  const doc = useEntity(docId)
  const docName = doc?.data?.document?.metadata?.name
  let toolText = 'Read Document'
  if (docName) {
    toolText = `Read Document: ${docName}`
  }
  return <BaseToolPresentation message={message} text={toolText} />
}

function ToolPresentation({message}: {message: AssistMessage}) {
  if (message.toolName === 'readDocument') {
    return <ToolReadDocumentPresentation message={message} />
  }
  return (
    <BaseToolPresentation
      message={message}
      text={getToolTitle(message.toolName)}
    />
  )
}

function BaseToolPresentation({
  message,
  text,
}: {
  message: AssistMessage
  text: string
}) {
  const Icon = getToolIcon(message.toolName)
  return (
    <XStack gap="$2" alignItems="center">
      <Text fontWeight="bold" color="$color9" fontSize="$2">
        Assistant: {text}
      </Text>
      <Icon color="$color9" size={18} />
    </XStack>
  )
}

function AssistMessageItem({message}: {message: AssistMessage}) {
  if (message.role === 'tool') {
    return (
      <YStack>
        <HoverCard
          content={
            <YStack gap="$3">
              <Text color="$color9" fontWeight="bold">
                Assistant called tool: {getToolTitle(message.toolName)}
              </Text>
              <Button
                onPress={() => {
                  copyTextToClipboard(JSON.stringify(message, null, 2))
                }}
                size="$2"
                icon={Clipboard}
              >
                Debug: Copy Details
              </Button>
            </YStack>
          }
        >
          <ToolPresentation message={message} />
        </HoverCard>
      </YStack>
    )
  }
  if (message.content === '') {
    return <Spinner />
  }
  return (
    <YStack gap="$1">
      <Text fontSize="$2" color="$color11">
        {message.role === 'user' ? 'You' : 'Assistant'}
      </Text>
      <Text fontSize="$4">{message.content}</Text>
    </YStack>
  )
}

function ThreadMessageForm({threadId}: {threadId: string}) {
  const {ai} = useAppContext()
  const [message, setMessage] = useState('')
  const [thread, setThread] = useState<AssistThread | null>(null)
  const inputRef = useRef<Input>(null)

  // Check if AI is currently generating by looking at the last assistant message
  const isGenerating =
    thread?.messages.filter((m) => m.role === 'assistant').slice(-1)[0]
      ?.completeTime === undefined

  useEffect(() => {
    ai?.getThread(threadId).then((thread) => {
      setThread({
        ...thread,
        messages: thread.messages.filter(
          (message) => message.role !== 'system',
        ),
      })
    })
  }, [threadId])

  useEffect(() => {
    const unsubscribe = ai?.subscribeThread(threadId, (message) => {
      if (message.role === 'assistant' && message.content === '') {
        return
      }
      setThread((thread) => {
        if (!thread) return thread
        return {
          ...thread,
          messages: [
            ...thread.messages.filter((m) => m.id !== message.id),
            message,
          ],
        }
      })
    })
    return () => unsubscribe?.()
  }, [ai, threadId])

  function sendMessage() {
    if (!message.trim() || isGenerating) return
    console.log('sendMessage', message)
    ai?.continueThread(threadId, message).then(() => {
      setMessage('')
      inputRef.current?.focus()
    })
  }

  return (
    <XStack padding="$3" borderTopWidth={1} borderTopColor="$borderColor">
      <Input
        ref={inputRef}
        value={message}
        onChangeText={setMessage}
        onKeyPress={(e) => {
          if (e.nativeEvent.key === 'Enter' && !isGenerating) {
            sendMessage()
          }
        }}
        placeholder="Continue the conversation..."
        autoFocus
        flex={1}
        disabled={isGenerating}
      />
      {isGenerating ? (
        <Spinner position="absolute" right="$5" top="$5" size="small" />
      ) : (
        <Button
          position="absolute"
          right="$5"
          size="$2"
          top="$5"
          onPress={sendMessage}
          icon={ArrowRightCircle}
          disabled={!message.trim()}
        />
      )}
    </XStack>
  )
}

const AssistDialogTitle = styled(SizableText, {
  fontWeight: 'bold',
  fontSize: '$4',
  marginBottom: '$2',
})

function AssistHistoryDialog({
  input,
  onClose,
}: {
  input: true
  onClose: () => void
}) {
  const [selectedThread, setSelectedThread] =
    useState<ListedAssistThread | null>(null)
  const threads = trpc.assist.listThreads.useQuery()

  if (selectedThread) {
    return (
      <YStack gap="$2">
        <XStack padding="$3">
          <Button
            size="$1"
            icon={ArrowLeft}
            onPress={() => setSelectedThread(null)}
          >
            Back
          </Button>
        </XStack>
        <AssistDialogTitle paddingHorizontal="$3">
          Assistant Thread ({formattedDate(selectedThread.createdAt)})
        </AssistDialogTitle>

        <AssistThreadView threadId={selectedThread.id} />
      </YStack>
    )
  }
  return (
    <YStack gap="$2" padding="$3">
      <AssistDialogTitle>Assistant Thread History</AssistDialogTitle>
      {threads.data?.map((thread) => (
        <Button key={thread.id} onPress={() => setSelectedThread(thread)}>
          <XStack f={1} justifyContent="space-between">
            <Text numberOfLines={1}>{thread.initialPrompt}</Text>
            <Text color="$color9">{formattedDate(thread.createdAt)}</Text>
          </XStack>
        </Button>
      ))}
    </YStack>
  )
}
