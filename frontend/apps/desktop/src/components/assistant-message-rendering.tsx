import {buildLegacyChatMessageParts, type ChatMessagePart, type ChatToolPart} from '@/models/chat-parts'
import {getSeedToolMetadata} from '../../../../../agents/protocol/src/tool-registry'
import {useOpenUrl} from '@/open-url'
import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import {Button} from '@shm/ui/button'
import {cn} from '@shm/ui/utils'
import {
  ArrowUpRight,
  BookOpenText,
  ChevronDown,
  ChevronRight,
  Compass,
  Info,
  Loader2,
  PenLine,
  Search,
  Wrench,
} from 'lucide-react'
import React, {Suspense, useState} from 'react'
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@shm/ui/components/dialog'
import {Markdown} from './markdown'

/** Renders a chat message bubble shared by the assistant panel and Agents session UI. */
export const ChatMessageBubble = React.memo(function ChatMessageBubble({message}: {message: ChatBubbleMessage}) {
  const [showRawMarkdown, setShowRawMarkdown] = useState(false)
  const isUser = message.role === 'user'
  const rawMarkdown = message.rawMarkdown ?? message.content

  return (
    <div className="group/message my-1.5">
      {isUser ? (
        <div className="flex items-start gap-1">
          <div className="ml-6 min-w-0 flex-1 rounded-lg border border-sky-200 bg-sky-100 px-3 py-2 text-[13px] text-slate-950 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-50 [&_.ProseMirror]:!text-[13px] [&_.hm-prose]:!text-[13px]">
            {message.blocks?.length ? (
              <div className="text-foreground rounded-md bg-transparent px-1 py-0.5 [&_.ProseMirror]:!bg-transparent [&_.bn-container]:!bg-transparent [&_.bn-editor]:!bg-transparent [&_.hm-prose]:!font-sans [&_.hm-prose]:!text-base">
                <Suspense fallback={<Markdown>{message.content || ''}</Markdown>}>
                  <RichMessageBlocks blocks={message.blocks} />
                </Suspense>
              </div>
            ) : (
              <Markdown>{message.content || ''}</Markdown>
            )}
          </div>
          {rawMarkdown ? <RawMarkdownButton onClick={() => setShowRawMarkdown(true)} /> : null}
        </div>
      ) : (
        <AssistantMessageParts
          parts={getAssistantMessageParts(message)}
          rawMarkdownButton={rawMarkdown ? <RawMarkdownButton onClick={() => setShowRawMarkdown(true)} /> : null}
        />
      )}
      {message.errorMessage ? (
        <div className="border-destructive/30 bg-destructive/10 text-destructive mt-1 mr-6 rounded-lg border px-3 py-2 text-xs">
          <div className="mb-1 font-medium">Error</div>
          <p className="whitespace-pre-wrap">{message.errorMessage}</p>
        </div>
      ) : null}
      {rawMarkdown ? (
        <Dialog open={showRawMarkdown} onOpenChange={setShowRawMarkdown}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Message details</DialogTitle>
              <DialogDescription>This is the exact markdown text represented by this message.</DialogDescription>
            </DialogHeader>
            {message.shareUrl ? (
              <div className="flex flex-col gap-2">
                <div className="text-muted-foreground text-xs">Share URL</div>
                <div className="flex gap-2">
                  <code className="bg-muted min-w-0 flex-1 overflow-auto rounded-md p-2 text-xs whitespace-nowrap">
                    {message.shareUrl}
                  </code>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void navigator.clipboard?.writeText(message.shareUrl!)}
                  >
                    Copy
                  </Button>
                </div>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2 text-xs">
              {message.sessionId ? (
                <span className="bg-muted rounded px-2 py-1">Session: {message.sessionId}</span>
              ) : null}
              {message.eventId ? <span className="bg-muted rounded px-2 py-1">Message: {message.eventId}</span> : null}
              {typeof message.seq === 'number' ? (
                <span className="bg-muted rounded px-2 py-1">Seq: {message.seq}</span>
              ) : null}
            </div>
            <pre className="bg-muted max-h-[50vh] overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
              {rawMarkdown}
            </pre>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  )
})

/** Renders assistant message parts with the same markdown, tool, and streaming cursor UI used by the desktop assistant. */
export const AssistantMessageParts = React.memo(function AssistantMessageParts({
  parts,
  isStreaming = false,
  rawMarkdownButton,
}: {
  parts: ChatMessagePart[]
  isStreaming?: boolean
  rawMarkdownButton?: React.ReactNode
}) {
  const rawButtonIndex = rawMarkdownButton
    ? parts.reduce((lastTextIndex, part, index) => (part.type === 'text' ? index : lastTextIndex), -1)
    : -1

  return parts.map((part, index) => {
    if (part.type === 'tool') {
      return <ToolCallItem key={`${part.id}:${index}`} item={part} />
    }

    const showCursor = isStreaming && index === parts.length - 1
    return (
      <div key={`text:${index}`} className="flex items-start gap-1">
        <div className="bg-muted my-1 mr-6 min-w-0 flex-1 rounded-lg px-3 py-2 text-sm">
          <Markdown enableGfm={!isStreaming}>{part.text}</Markdown>
          {showCursor && <span className="bg-foreground inline-block h-3 w-1 animate-pulse" />}
        </div>
        {index === rawButtonIndex ? rawMarkdownButton : null}
      </div>
    )
  })
})

/** Message shape accepted by the shared assistant chat bubble renderer. */
export type ChatBubbleMessage = {
  role?: string
  content?: string
  parts?: ChatMessagePart[]
  toolCalls?: Array<{id: string; name: string; args: Record<string, unknown>}>
  toolResults?: Array<{id: string; name: string; result: string; rawOutput?: unknown}>
  errorMessage?: string
  rawMarkdown?: string
  blocks?: HMBlockNode[]
  eventId?: string
  sessionId?: string
  seq?: number
  shareUrl?: string
}

const RichMessageBlocks = React.lazy(async () => {
  const module = await import('@shm/editor/readonly-viewer')
  return {
    default: ({blocks}: {blocks: HMBlockNode[]}) => (
      <module.ReadOnlyViewer
        blocks={blocks}
        commentStyle
        textUnit={13}
        layoutUnit={18}
        className="agent-message-blocks"
      />
    ),
  }
})

function RawMarkdownButton({onClick}: {onClick: () => void}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-muted-foreground hover:text-foreground mt-1 rounded p-1 opacity-0 transition-opacity group-hover/message:opacity-100 focus:opacity-100"
      aria-label="Show markdown sent to the LLM"
      title="Show markdown sent to the LLM"
    >
      <Info className="size-3.5" />
    </button>
  )
}

function getAssistantMessageParts(message: ChatBubbleMessage) {
  if (message.parts && message.parts.length > 0) {
    return message.parts
  }

  return buildLegacyChatMessageParts({
    content: message.content,
    toolCalls: message.toolCalls,
    toolResults: message.toolResults,
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function formatToolDebugValue(value: unknown): string {
  if (value === undefined) return '(none)'
  if (typeof value === 'string') return value

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function formatInlineValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`
  return undefined
}

function getPathValues(value: unknown, path?: string): unknown[] {
  if (!path) return [value]

  const parts = path.split('.').filter(Boolean)
  let values = [value]

  for (const part of parts) {
    const arrayKey = part.endsWith('[]') ? part.slice(0, -2) : undefined
    values = values.flatMap((current) => {
      if (!isRecord(current)) return []
      const next = current[arrayKey ?? part]
      if (arrayKey) return Array.isArray(next) ? next : []
      return next === undefined ? [] : [next]
    })
  }

  return values
}

function firstInlinePathValue(value: unknown, path?: string): string | undefined {
  for (const item of getPathValues(value, path)) {
    const formatted = formatInlineValue(item)
    if (formatted) return formatted
  }
  return undefined
}

function ToolChip({children}: {children: React.ReactNode}) {
  return (
    <span className="bg-background/75 text-muted-foreground rounded-full border px-1.5 py-0.5 text-[9px] font-medium whitespace-nowrap">
      {children}
    </span>
  )
}

function ToolResourceLink({url, label}: {url: string; label: string}) {
  const openUrl = useOpenUrl()

  return (
    <button
      type="button"
      title={url}
      onClick={(event) => openUrl(url, event.metaKey || event.shiftKey)}
      className="bg-background/75 hover:bg-background inline-flex max-w-40 items-center gap-1 rounded-full border px-2 py-0.75 text-left text-[10px] font-medium transition-colors"
    >
      <span className="truncate">{label}</span>
      <ArrowUpRight className="size-2.5 shrink-0" />
    </button>
  )
}

function ToolTextLink({url, children}: {url: string; children: React.ReactNode}) {
  const openUrl = useOpenUrl()

  return (
    <button
      type="button"
      title={url}
      onClick={(event) => openUrl(url, event.metaKey || event.shiftKey)}
      className="text-foreground font-medium decoration-1 underline-offset-2 hover:underline"
    >
      {children}
    </button>
  )
}

function ToolCallDebugDialog({
  item,
  open,
  onOpenChange,
}: {
  item: ChatToolPart
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] w-[min(44rem,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle>{item.name}</DialogTitle>
          <DialogDescription>Raw tool call payload captured during the assistant response.</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 gap-3">
          <div className="min-h-0 space-y-1">
            <div className="text-muted-foreground text-[10px] font-medium tracking-[0.18em] uppercase">Input</div>
            <pre className="bg-muted max-h-48 overflow-auto rounded-xl p-3 text-[11px] whitespace-pre-wrap">
              {formatToolDebugValue(item.args)}
            </pre>
          </div>
          <div className="min-h-0 space-y-1">
            <div className="text-muted-foreground text-[10px] font-medium tracking-[0.18em] uppercase">Output</div>
            <pre className="bg-muted max-h-72 overflow-auto rounded-xl p-3 text-[11px] whitespace-pre-wrap">
              {formatToolDebugValue(item.rawOutput ?? item.result)}
            </pre>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function getToolLinks(item: ChatToolPart) {
  const metadata = getSeedToolMetadata(item.name)
  const input = item.args
  const output = item.rawOutput
  const links = metadata?.render.links || []
  const seen = new Set<string>()

  return links.flatMap((link) => {
    const source = link.source === 'input' ? input : output
    const urls = getPathValues(source, link.path)
    const labels = link.labelPath ? getPathValues(source, link.labelPath) : []

    return urls.flatMap((url, index) => {
      if (typeof url !== 'string' || !url) return []
      if (seen.has(url)) return []
      seen.add(url)
      const label = link.label || formatInlineValue(labels[index]) || shortUrlLabel(url)
      return [{url, label}]
    })
  })
}

function shortUrlLabel(url: string): string {
  if (url.length <= 34) return url
  return `${url.slice(0, 18)}…${url.slice(-12)}`
}

function getToolSummary(item: ChatToolPart): string | undefined {
  const metadata = getSeedToolMetadata(item.name)
  const outputSummary = firstInlinePathValue(item.rawOutput, metadata?.render.summaryOutputPath)
  if (outputSummary) return outputSummary

  const inputSummary = firstInlinePathValue(item.args, metadata?.render.summaryArg || metadata?.render.primaryArg)
  if (inputSummary) return inputSummary

  return item.result
}

function getToolDetails(item: ChatToolPart) {
  const metadata = getSeedToolMetadata(item.name)
  const details = metadata?.render.details || [
    {label: 'Input', source: 'input' as const},
    {label: 'Output', source: 'output' as const},
  ]

  return details.flatMap((detail) => {
    const source = detail.source === 'input' ? item.args : item.rawOutput ?? item.result
    const value = detail.path ? getPathValues(source, detail.path)[0] : source
    if (value === undefined) return []
    return [{...detail, value}]
  })
}

function getToolString(value: unknown, path: string): string | undefined {
  const found = getPathValues(value, path)[0]
  return typeof found === 'string' && found ? found : undefined
}

function getToolCustomView(item: ChatToolPart) {
  const command = getToolString(item.args, 'command')
  return getSeedToolMetadata(item.name)?.render.customViews?.find((view) => view.command === command)
}

function buildCommentUrl(targetUrl: string, commentId: string): string {
  const hashIndex = targetUrl.indexOf('#')
  const withoutHash = hashIndex === -1 ? targetUrl : targetUrl.slice(0, hashIndex)
  const queryIndex = withoutHash.indexOf('?')
  if (queryIndex === -1) return `${withoutHash}/:comments/${commentId}`
  return `${withoutHash.slice(0, queryIndex)}/:comments/${commentId}${withoutHash.slice(queryIndex)}`
}

function isCommentRecordId(value: string | undefined): value is string {
  return Boolean(value && value.includes('/') && !value.startsWith('bafy'))
}

function isCommentUrlForRecordId(value: string | undefined): value is string {
  return Boolean(value && /\/:comments\/[^/?#]+\/[^?#]+/.test(value))
}

function NewCommentSummary({item}: {item: ChatToolPart}) {
  const output = item.rawOutput
  const targetUrl = getToolString(output, 'targetUrl') || getToolString(output, 'target')
  const commentRecordId = [getToolString(output, 'commentRecordId'), getToolString(output, 'commentId')].find(
    isCommentRecordId,
  )
  const rawCommentUrl = getToolString(output, 'commentUrl')
  const commentUrl = isCommentUrlForRecordId(rawCommentUrl)
    ? rawCommentUrl
    : targetUrl && commentRecordId
    ? buildCommentUrl(targetUrl, commentRecordId)
    : undefined
  const authorPublicKey = getToolString(output, 'authorUrl') || getToolString(output, 'signer.publicKey')
  const authorUrl = authorPublicKey?.startsWith('hm://')
    ? authorPublicKey
    : authorPublicKey
    ? `hm://${authorPublicKey}`
    : undefined
  const authorName =
    getToolString(output, 'authorName') || getToolString(output, 'signer.profileName') || authorPublicKey || 'Author'
  const targetName = getToolString(output, 'targetName') || targetUrl || 'document'

  return (
    <span className="text-foreground/80 min-w-0 truncate">
      {commentUrl ? (
        <ToolTextLink url={commentUrl}>New Comment</ToolTextLink>
      ) : (
        <span className="font-medium">New Comment</span>
      )}{' '}
      by {authorUrl ? <ToolTextLink url={authorUrl}>{authorName}</ToolTextLink> : <span>{authorName}</span>} on{' '}
      {targetUrl ? <ToolTextLink url={targetUrl}>{targetName}</ToolTextLink> : <span>{targetName}</span>}
    </span>
  )
}

function NewCommentDetails({item}: {item: ChatToolPart}) {
  const markdown =
    getToolString(item.rawOutput, 'markdown') ||
    getToolString(item.args, 'input.body') ||
    getToolString(item.args, 'input.content') ||
    getToolString(item.args, 'body') ||
    getToolString(item.args, 'content')

  return (
    <div className="space-y-1">
      <div className="text-muted-foreground text-[10px] font-medium tracking-[0.18em] uppercase">Comment</div>
      <div className="bg-background/60 text-foreground max-h-72 overflow-auto rounded-md border px-2.5 py-2">
        <Markdown>{markdown || item.result || ''}</Markdown>
      </div>
    </div>
  )
}

const toolColorClasses = {
  sky: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  emerald: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  violet: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300',
  amber: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  indigo: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
  muted: 'border-border bg-muted/60 text-muted-foreground',
  hidden: 'border-border bg-muted/60 text-muted-foreground',
}

const toolIcons = {
  search: Search,
  read: BookOpenText,
  resolve: Wrench,
  navigate: Compass,
  write: PenLine,
  generic: Wrench,
  hidden: Wrench,
}

function ToolCallLine({item}: {item: ChatToolPart}) {
  const [expanded, setExpanded] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const metadata = getSeedToolMetadata(item.name)
  const render = metadata?.render
  const Icon = toolIcons[render?.kind || 'generic']
  const isPending = item.result === undefined && item.rawOutput === undefined
  const details = getToolDetails(item)
  const summary = getToolSummary(item)
  const links = getToolLinks(item)
  const colorClass = toolColorClasses[render?.color || 'muted']
  const customView = getToolCustomView(item)

  return (
    <>
      <div className={cn('my-1.5 mr-6 rounded-lg border px-2 py-1.5 text-xs', colorClass)}>
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            title={expanded ? 'Hide tool details' : 'Show tool details'}
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
            className="hover:bg-background/70 rounded p-0.5"
          >
            {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </button>
          {isPending ? <Loader2 className="size-3 shrink-0 animate-spin" /> : <Icon className="size-3 shrink-0" />}
          {customView?.kind === 'new-comment' ? (
            <NewCommentSummary item={item} />
          ) : (
            <>
              <span className="shrink-0 font-medium">{render?.label || item.name}</span>
              {summary ? <span className="text-foreground/75 min-w-0 truncate">{summary}</span> : null}
              <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1 overflow-hidden">
                {links.map((link) => (
                  <ToolResourceLink key={link.url} url={link.url} label={link.label} />
                ))}
              </div>
            </>
          )}
          {isPending ? <ToolChip>{render?.pendingLabel || 'Running'}</ToolChip> : null}
          <button
            type="button"
            title="View raw tool input/output"
            onClick={() => setDetailsOpen(true)}
            className="hover:bg-background/70 text-muted-foreground hover:text-foreground bg-background/60 ml-auto rounded-full border p-0.75"
          >
            <Info className="size-3" />
          </button>
        </div>
        {expanded ? (
          <div className="mt-2 space-y-2 border-t pt-2">
            {customView?.kind === 'new-comment' ? (
              <NewCommentDetails item={item} />
            ) : (
              details.map((detail) => (
                <div key={`${detail.label}:${detail.path || detail.source}`} className="space-y-1">
                  <div className="text-muted-foreground text-[10px] font-medium tracking-[0.18em] uppercase">
                    {detail.label}
                  </div>
                  {detail.format === 'markdown' && typeof detail.value === 'string' ? (
                    <div className="bg-background/60 text-foreground max-h-72 overflow-auto rounded-md border px-2.5 py-2">
                      <Markdown>{detail.value}</Markdown>
                    </div>
                  ) : (
                    <pre className="bg-background/60 text-foreground max-h-72 overflow-auto rounded-md border p-2 text-[11px] whitespace-pre-wrap">
                      {formatToolDebugValue(detail.value)}
                    </pre>
                  )}
                </div>
              ))
            )}
          </div>
        ) : null}
      </div>
      <ToolCallDebugDialog item={item} open={detailsOpen} onOpenChange={setDetailsOpen} />
    </>
  )
}

function ToolCallItem({item}: {item: ChatToolPart}) {
  return <ToolCallLine item={item} />
}
