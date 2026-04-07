import {client} from '@/trpc'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useMutation, useQuery} from '@tanstack/react-query'
import {toast} from '@shm/ui/toast'
import {useCallback, useEffect, useState} from 'react'
import {
  appendChatTextPart,
  appendChatToolCalls,
  applyChatToolResults,
  type ChatMessagePart,
  type ChatToolCall,
  type ChatToolResult,
} from './chat-parts'

/** A chat stream event emitted by the desktop main process while an assistant response is in flight. */
export type ChatStreamEvent = {
  type: 'stream_start' | 'text_delta' | 'tool_calls' | 'tool_results' | 'stream_end' | 'stream_error' | 'message_added'
  sessionId: string
  delta?: string
  message?: any
  toolCalls?: ChatToolCall[]
  toolResults?: ChatToolResult[]
  error?: string
}

/** Lists available local chat sessions. */
export function useChatSessions() {
  return useQuery({
    queryKey: [queryKeys.CHAT_SESSIONS],
    queryFn: () => client.chat.listSessions.query(),
  })
}

/** Loads a single chat session with its message history. */
export function useChatSession(sessionId: string | null) {
  return useQuery({
    queryKey: [queryKeys.CHAT_SESSION, sessionId],
    queryFn: () => (sessionId ? client.chat.getSession.query(sessionId) : null),
    enabled: !!sessionId,
  })
}

/** Creates a new empty chat session. */
export function useCreateChatSession() {
  return useMutation({
    mutationFn: (input?: {title?: string}) => client.chat.createSession.mutate(input),
    onSuccess() {
      invalidateQueries([queryKeys.CHAT_SESSIONS])
    },
    onError() {
      toast.error('Could not create chat session')
    },
  })
}

/** Deletes a chat session and refreshes the local session list. */
export function useDeleteChatSession() {
  return useMutation({
    mutationFn: (sessionId: string) => client.chat.deleteSession.mutate(sessionId),
    onSuccess() {
      invalidateQueries([queryKeys.CHAT_SESSIONS])
    },
  })
}

/** Sets the provider used for future messages in a chat session. */
export function useSetSessionProvider() {
  return useMutation({
    mutationFn: (input: {sessionId: string; providerId: string}) => client.chat.setSessionProvider.mutate(input),
    onSuccess(_data, variables) {
      invalidateQueries([queryKeys.CHAT_SESSION, variables.sessionId])
      invalidateQueries([queryKeys.AI_LAST_USED_PROVIDER])
    },
  })
}

/** Sends a user message to the assistant for a given session. */
export function useSendChatMessage() {
  return useMutation({
    mutationFn: (input: {
      sessionId: string
      content: string | string[]
      providerId?: string
      documentContext?: {
        url?: string
        title?: string
        view?: 'document' | 'comments' | 'directory' | 'activity' | 'collaborators' | 'feed' | 'inspect' | 'draft'
        activePanel?: 'comments' | 'activity' | 'directory' | 'collaborators' | 'options'
        openComment?: string
        focusedBlockId?: string
        focusedBlockRange?: {start: number; end: number}
        isDraft?: boolean
        editingDocumentUrl?: string
      }
    }) => client.chat.sendMessage.mutate(input),
    onSuccess(_data, variables) {
      invalidateQueries([queryKeys.CHAT_SESSION, variables.sessionId])
    },
    onError(error) {
      toast.error(`Chat error: ${(error as Error).message}`)
    },
  })
}

/** Tracks the ordered live stream for the current assistant response. */
export function useChatStream(sessionId: string | null) {
  const [streamParts, setStreamParts] = useState<ChatMessagePart[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamComplete, setStreamComplete] = useState(false)

  const clearStream = useCallback(() => {
    setStreamParts([])
    setStreamComplete(false)
  }, [])

  useEffect(() => {
    const chatStreamEvents = (window as any).chatStreamEvents
    if (!chatStreamEvents) return

    const unsubscribe = chatStreamEvents.subscribe((event: ChatStreamEvent) => {
      if (event.sessionId !== sessionId) return

      switch (event.type) {
        case 'stream_start':
          setIsStreaming(true)
          setStreamComplete(false)
          setStreamParts([])
          break
        case 'text_delta':
          setStreamParts((prev) => appendChatTextPart(prev, event.delta || ''))
          break
        case 'tool_calls':
          setStreamParts((prev) => appendChatToolCalls(prev, event.toolCalls || []))
          break
        case 'tool_results':
          setStreamParts((prev) => applyChatToolResults(prev, event.toolResults || []))
          break
        case 'stream_end':
          setIsStreaming(false)
          // Keep streaming content visible until query refetch confirms the persisted message.
          // clearStream() will be called by the component once the new message appears in session data.
          setStreamComplete(true)
          invalidateQueries([queryKeys.CHAT_SESSION, sessionId])
          break
        case 'stream_error':
          setIsStreaming(false)
          clearStream()
          break
      }
    })

    return unsubscribe
  }, [sessionId, clearStream])

  const stopStream = useCallback(() => {
    if (sessionId) {
      ;(window as any).ipc?.send('chatStopStream', sessionId)
    }
  }, [sessionId])

  return {streamParts, isStreaming, streamComplete, clearStream, stopStream}
}
