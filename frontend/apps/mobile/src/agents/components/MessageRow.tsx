/**
 * One row of the shared log.
 *
 * The log is not a chat transcript — the user, the agent, the runtime and triggers all write to it,
 * and every event carries the actor that produced it. The actor is checked before the role, because
 * the runtime writes continuation prompts and obligation notices as `role: 'user'` (the only turn a
 * model takes instruction from) while nobody typed those words. Rendering those as the user's own
 * blue bubble would be a lie about who said what.
 */

import type {ChatBubbleMessage, ChatMessagePart, ChatToolPart} from '@shm/ui/agents/chat-parts'
import {buildLegacyChatMessageParts} from '@shm/ui/agents/chat-parts'
import React, {useMemo} from 'react'
import {StyleSheet, View} from 'react-native'
import {radius, theme} from '../../theme'
import {Label} from '../ui/primitives'
import {Markdown} from '../ui/Markdown'
import {ToolRow} from './ToolRow'

export function MessageRow({message, onOpenUrl}: {message: ChatBubbleMessage; onOpenUrl?: (url: string) => void}) {
  const actor = message.actor ?? (message.role === 'user' ? 'user' : 'agent')

  if (actor === 'user') return <UserBubble message={message} />
  if (actor === 'system') return <SystemRow message={message} />
  return <AgentParts message={message} onOpenUrl={onOpenUrl} />
}

function UserBubble({message}: {message: ChatBubbleMessage}) {
  return (
    <View style={styles.userRow}>
      <View style={styles.userBubble}>
        <Markdown style={styles.userText}>{message.content ?? ''}</Markdown>
      </View>
    </View>
  )
}

/**
 * The machinery talking about the conversation rather than a voice in it: no bubble, no name, set
 * in behind a left rule.
 */
function SystemRow({message}: {message: ChatBubbleMessage}) {
  return (
    <View style={styles.systemRow}>
      <Label size="sm" tone="muted">
        {message.content ?? ''}
      </Label>
    </View>
  )
}

function AgentParts({message, onOpenUrl}: {message: ChatBubbleMessage; onOpenUrl?: (url: string) => void}) {
  // Older transcripts carry toolCalls/toolResults alongside the text instead of interleaved parts;
  // the shared builder normalizes both into one ordered list so the rows read the same either way.
  const parts: ChatMessagePart[] = useMemo(() => {
    if (message.parts?.length) return message.parts
    return buildLegacyChatMessageParts(message)
  }, [message])

  return (
    <View style={styles.agentRow}>
      {parts.map((part, index) =>
        part.type === 'tool' ? (
          <ToolRow key={`${part.id}-${index}`} part={part as ChatToolPart} onOpenUrl={onOpenUrl} />
        ) : (
          <Markdown key={index} onOpenUrl={onOpenUrl}>
            {part.text}
          </Markdown>
        ),
      )}
      {message.errorMessage ? (
        <Label size="sm" tone="danger">
          {message.errorMessage}
        </Label>
      ) : null}
    </View>
  )
}

/** The trailing assistant text still streaming in, with a cursor so the reader knows it is live. */
export function StreamingRow({text}: {text: string}) {
  return (
    <View style={styles.agentRow}>
      <Markdown>{text}</Markdown>
      <View style={styles.cursor} />
    </View>
  )
}

/** A turn that failed, with the retry affordance the caller decides to offer. */
export function ErrorRow({message, action}: {message: string; action?: React.ReactNode}) {
  return (
    <View style={styles.errorRow}>
      <Label size="sm" tone="danger">
        {message}
      </Label>
      {action}
    </View>
  )
}

const styles = StyleSheet.create({
  userRow: {alignItems: 'flex-end'},
  userBubble: {
    maxWidth: '88%',
    backgroundColor: theme.accent,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: theme.brand,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  userText: {color: theme.foreground},

  systemRow: {borderLeftWidth: 2, borderLeftColor: theme.border, paddingLeft: 10, paddingVertical: 2},

  agentRow: {gap: 8, alignItems: 'stretch'},
  cursor: {width: 7, height: 15, backgroundColor: theme.brand, opacity: 0.7, borderRadius: 1},

  errorRow: {
    borderWidth: 1,
    borderColor: theme.danger,
    borderRadius: radius.lg,
    padding: 10,
    gap: 8,
    backgroundColor: 'rgba(255,107,107,0.08)',
  },
})
