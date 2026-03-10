import {client} from '@/trpc'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useMutation, useQuery} from '@tanstack/react-query'
import {toast} from '@shm/ui/toast'
import {useCallback, useEffect, useRef, useState} from 'react'

export type ChatStreamEvent = {
  type: 'stream_start' | 'text_delta' | 'tool_calls' | 'tool_results' | 'stream_end' | 'stream_error' | 'message_added'
  sessionId: string
  delta?: string
  message?: any
  toolCalls?: Array<{id: string; name: string; args: Record<string, unknown>}>
  toolResults?: Array<{id: string; name: string; result: string}>
  error?: string
}

export function useChatSessions() {
  return useQuery({
    queryKey: [queryKeys.CHAT_SESSIONS],
    queryFn: () => client.chat.listSessions.query(),
  })
}

export function useChatSession(sessionId: string | null) {
  return useQuery({
    queryKey: [queryKeys.CHAT_SESSION, sessionId],
    queryFn: () => (sessionId ? client.chat.getSession.query(sessionId) : null),
    enabled: !!sessionId,
  })
}

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

export function useDeleteChatSession() {
  return useMutation({
    mutationFn: (sessionId: string) => client.chat.deleteSession.mutate(sessionId),
    onSuccess() {
      invalidateQueries([queryKeys.CHAT_SESSIONS])
    },
  })
}

export function useSetSessionProvider() {
  return useMutation({
    mutationFn: (input: {sessionId: string; providerId: string}) => client.chat.setSessionProvider.mutate(input),
    onSuccess(_data, variables) {
      invalidateQueries([queryKeys.CHAT_SESSION, variables.sessionId])
      invalidateQueries([queryKeys.AI_LAST_USED_PROVIDER])
    },
  })
}

export function useSendChatMessage() {
  return useMutation({
    mutationFn: (input: {
      sessionId: string
      content: string | string[]
      providerId?: string
      documentContext?: {url?: string; title?: string}
    }) => client.chat.sendMessage.mutate(input),
    onSuccess(_data, variables) {
      invalidateQueries([queryKeys.CHAT_SESSION, variables.sessionId])
    },
    onError(error) {
      toast.error(`Chat error: ${(error as Error).message}`)
    },
  })
}

export function useChatStream(sessionId: string | null) {
  const [streamingText, setStreamingText] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamComplete, setStreamComplete] = useState(false)
  const [pendingToolCalls, setPendingToolCalls] = useState<ChatStreamEvent['toolCalls']>([])
  const [pendingToolResults, setPendingToolResults] = useState<ChatStreamEvent['toolResults']>([])
  const streamingTextRef = useRef('')

  const clearStream = useCallback(() => {
    setStreamingText('')
    streamingTextRef.current = ''
    setPendingToolCalls([])
    setPendingToolResults([])
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
          setStreamingText('')
          streamingTextRef.current = ''
          setPendingToolCalls([])
          setPendingToolResults([])
          break
        case 'text_delta':
          streamingTextRef.current += event.delta || ''
          setStreamingText(streamingTextRef.current)
          break
        case 'tool_calls':
          setPendingToolCalls((prev) => [...(prev || []), ...(event.toolCalls || [])])
          break
        case 'tool_results':
          setPendingToolResults((prev) => [...(prev || []), ...(event.toolResults || [])])
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

  return {streamingText, isStreaming, streamComplete, pendingToolCalls, pendingToolResults, clearStream, stopStream}
}
