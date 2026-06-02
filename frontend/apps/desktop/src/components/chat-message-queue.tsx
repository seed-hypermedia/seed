import React, {useCallback, useEffect, useRef, useState} from 'react'

/** Manages queued chat messages while a chat backend is busy responding. */
export function useQueuedChatMessages<Message = string>({
  isBusy,
  onFlush,
}: {
  isBusy: boolean
  onFlush: (messages: Message[]) => void | Promise<void>
}) {
  const queuedMessagesRef = useRef<Message[]>([])
  const [queuedMessages, setQueuedMessages] = useState<Message[]>([])

  const queueMessage = useCallback((message: Message) => {
    queuedMessagesRef.current = [...queuedMessagesRef.current, message]
    setQueuedMessages([...queuedMessagesRef.current])
  }, [])

  const flushQueuedMessages = useCallback(() => {
    if (queuedMessagesRef.current.length === 0) return
    const messages = [...queuedMessagesRef.current]
    queuedMessagesRef.current = []
    setQueuedMessages([])
    void onFlush(messages)
  }, [onFlush])

  useEffect(() => {
    if (!isBusy && queuedMessagesRef.current.length > 0) flushQueuedMessages()
  }, [flushQueuedMessages, isBusy])

  return {queuedMessages, queueMessage, flushQueuedMessages}
}

/** Renders queued chat messages consistently across assistant-like interfaces. */
export function QueuedChatMessages<Message = string>({
  messages,
  getText = (message) => String(message),
}: {
  messages: Message[]
  getText?: (message: Message) => string
}) {
  if (messages.length === 0) return null

  return (
    <div className="border-border border-t px-3 py-1">
      {messages.map((message, index) => (
        <div key={index} className="text-muted-foreground truncate text-[10px] italic">
          Queued: {getText(message)}
        </div>
      ))}
    </div>
  )
}
