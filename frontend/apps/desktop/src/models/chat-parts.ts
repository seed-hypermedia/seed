/** A streamed or persisted tool invocation attached to an assistant message. */
export type ChatToolCall = {
  id: string
  name: string
  args: Record<string, unknown>
}

/** A streamed or persisted tool result attached to an assistant message. */
export type ChatToolResult = {
  id: string
  name: string
  result: string
}

/** A markdown text fragment within an assistant message. */
export type ChatTextPart = {
  type: 'text'
  text: string
}

/** A tool item within an assistant message, optionally updated with a result later. */
export type ChatToolPart = {
  type: 'tool'
  id: string
  name: string
  args?: Record<string, unknown>
  result?: string
}

/** Ordered assistant message content used to interleave text and tool activity. */
export type ChatMessagePart = ChatTextPart | ChatToolPart

/** Appends streamed text while coalescing adjacent text fragments into one part. */
export function appendChatTextPart(parts: ChatMessagePart[], delta: string): ChatMessagePart[] {
  if (!delta) return parts

  const lastPart = parts[parts.length - 1]
  if (lastPart?.type === 'text') {
    return [...parts.slice(0, -1), {type: 'text', text: lastPart.text + delta}]
  }

  return [...parts, {type: 'text', text: delta}]
}

/** Appends tool calls at their observed position in the assistant response stream. */
export function appendChatToolCalls(parts: ChatMessagePart[], toolCalls: ChatToolCall[]): ChatMessagePart[] {
  if (toolCalls.length === 0) return parts

  return [
    ...parts,
    ...toolCalls.map((toolCall) => ({
      type: 'tool' as const,
      id: toolCall.id,
      name: toolCall.name,
      args: toolCall.args,
    })),
  ]
}

/** Merges tool results into existing tool parts without changing their position. */
export function applyChatToolResults(parts: ChatMessagePart[], toolResults: ChatToolResult[]): ChatMessagePart[] {
  if (toolResults.length === 0) return parts

  const resultsById = new Map(toolResults.map((toolResult) => [toolResult.id, toolResult]))
  const seenResults = new Set<string>()

  const nextParts = parts.map((part) => {
    if (part.type !== 'tool') return part

    const toolResult = resultsById.get(part.id)
    if (!toolResult) return part

    seenResults.add(toolResult.id)
    return {...part, result: toolResult.result}
  })

  for (const toolResult of toolResults) {
    if (seenResults.has(toolResult.id)) continue

    nextParts.push({
      type: 'tool',
      id: toolResult.id,
      name: toolResult.name,
      result: toolResult.result,
    })
  }

  return nextParts
}

/** Builds a best-effort ordered part list for legacy assistant messages that predate `parts`. */
export function buildLegacyChatMessageParts(input: {
  content?: string
  toolCalls?: ChatToolCall[]
  toolResults?: ChatToolResult[]
}): ChatMessagePart[] {
  let parts: ChatMessagePart[] = []

  parts = appendChatToolCalls(parts, input.toolCalls || [])
  parts = applyChatToolResults(parts, input.toolResults || [])

  if (input.content) {
    parts = appendChatTextPart(parts, input.content)
  }

  return parts
}
