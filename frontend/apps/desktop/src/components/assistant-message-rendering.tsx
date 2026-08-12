import {type AgentRunActivity, type SessionAttachmentInfo} from '@/agents-client'
import {buildLegacyChatMessageParts, type ChatMessagePart, type ChatToolPart} from '@/models/chat-parts'
import {getSeedTool, type SeedToolMetadata} from '../../../../../agents/protocol/src/tool-registry'
import {
  detailLinkTarget,
  firstInlinePathValue,
  formatInlineValue,
  getFirstToolString,
  getFirstToolValue,
  getPathValues,
  getToolString,
  isRecord,
  labelFromUrl,
  resolveToolRowSummary,
  shortUrlLabel,
  toolCallAddress,
  toolRowSourceChip,
  type ToolLinkTarget,
  type ToolRowSummary,
} from './tool-summary'
import {useOpenUrl} from '@/open-url'
import {useRun, useSessionAttachmentDataUrls} from '@/models/agents'
import {descendantsOf, isTerminalRun, RunWorkHierarchy, useRunTreeView} from '@/pages/agents/run-work'
import {useSelectedAccountId} from '@/selected-account'
import {useClickNavigate, useNavigate} from '@/utils/useNavigate'
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
  RotateCcw,
  Search,
  Wrench,
} from 'lucide-react'
import React, {Suspense, useMemo, useState} from 'react'
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@shm/ui/components/dialog'
import {Popover, PopoverContent, PopoverTrigger} from '@shm/ui/components/popover'
import {Markdown} from './markdown'

/** Renders a chat message bubble shared by the assistant panel and Agents session UI. */
export const ChatMessageBubble = React.memo(function ChatMessageBubble({
  message,
  liveActivity,
  serverUrl,
  accountUid,
  agentId,
}: {
  message: ChatBubbleMessage
  /** Live run activity, passed so a pending tool call row can show its in-flight progress. */
  liveActivity?: AgentRunActivity
  /** Agent server URL, needed to resolve session attachment images for display. */
  serverUrl?: string
  /** Signing account for server-side record queries (delegate work views). */
  accountUid?: string | null
  /** The agent this transcript belongs to, so tool rows link into its memory and tools. */
  agentId?: string
}) {
  const [showRawMarkdown, setShowRawMarkdown] = useState(false)
  const isUser = message.role === 'user'
  const rawMarkdown = message.rawMarkdown ?? message.content
  const resolvedBlocks = useAttachmentResolvedBlocks(serverUrl, message)

  return (
    <div className="group/message my-1.5">
      {isUser ? (
        <div className="flex items-start gap-1">
          <div className="ml-6 min-w-0 flex-1 rounded-lg border border-sky-200 bg-sky-100 px-3 py-2 text-[13px] text-slate-950 dark:border-sky-800 dark:bg-sky-950/60 dark:text-sky-50 [&_.ProseMirror]:!text-[13px] [&_.hm-prose]:!text-[13px]">
            {resolvedBlocks?.length ? (
              <div className="text-foreground rounded-md bg-transparent px-1 py-0.5 [&_.ProseMirror]:!bg-transparent [&_.bn-container]:!bg-transparent [&_.bn-editor]:!bg-transparent [&_.hm-prose]:!font-sans [&_.hm-prose]:!text-base">
                <Suspense fallback={<Markdown>{message.content || ''}</Markdown>}>
                  <RichMessageBlocks blocks={resolvedBlocks} />
                </Suspense>
              </div>
            ) : (
              <Markdown>{message.content || ''}</Markdown>
            )}
            {message.contextLines?.length ? <MessageContextInfo lines={message.contextLines} /> : null}
          </div>
          {rawMarkdown ? <RawMarkdownButton onClick={() => setShowRawMarkdown(true)} /> : null}
        </div>
      ) : (
        <AssistantMessageParts
          parts={getAssistantMessageParts(message)}
          liveActivity={liveActivity}
          serverUrl={serverUrl}
          accountUid={accountUid}
          agentId={agentId}
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
            {message.contextLines?.length ? (
              <div className="flex flex-col gap-2">
                <div className="text-muted-foreground text-xs">
                  Context shared with the agent (attached to this message, hidden from the chat)
                </div>
                <pre className="bg-muted max-h-[30vh] overflow-auto rounded-md p-3 text-xs whitespace-pre-wrap">
                  {message.contextLines.join('\n')}
                </pre>
              </div>
            ) : null}
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
  liveActivity,
  rawMarkdownButton,
  serverUrl,
  accountUid,
  agentId,
}: {
  parts: ChatMessagePart[]
  isStreaming?: boolean
  liveActivity?: AgentRunActivity
  rawMarkdownButton?: React.ReactNode
  /** Agent server the parts' tool calls ran on, for tools that link to server-side records. */
  serverUrl?: string
  /** Signing account for server-side record queries (the delegate work view needs it). */
  accountUid?: string | null
  /** The agent that ran these calls, so memory and tool addresses link into its own pages. */
  agentId?: string
}) {
  const rawButtonIndex = rawMarkdownButton
    ? parts.reduce((lastTextIndex, part, index) => (part.type === 'text' ? index : lastTextIndex), -1)
    : -1

  return parts.map((part, index) => {
    if (part.type === 'tool') {
      return (
        <ToolCallItem
          key={`${part.id}:${index}`}
          item={part}
          liveActivity={liveActivity}
          serverUrl={serverUrl}
          accountUid={accountUid}
          agentId={agentId}
        />
      )
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

/**
 * A failed turn, as the transcript shows it — with a way back when it is the last thing that
 * happened.
 *
 * Retry re-runs the failed turn from the durable transcript, so it is offered only on the trailing
 * error (see `retryableErrorRowKey`): further up, the conversation has already moved on.
 */
export function AgentErrorRow({
  message,
  compact,
  onRetry,
  retryPending,
}: {
  message: string
  /** Sidebar sizing: no frame, tighter type. */
  compact?: boolean
  /** Omitted when this error is not retryable, which is what hides the button. */
  onRetry?: () => void
  retryPending?: boolean
}) {
  return (
    <div
      className={
        compact
          ? 'text-destructive my-1 rounded-lg px-3 py-2 text-xs'
          : 'border-destructive/30 bg-destructive/10 text-destructive mr-6 rounded-lg border px-3 py-2 text-xs'
      }
    >
      {compact ? null : <div className="mb-1 font-medium">Error</div>}
      <p className="whitespace-pre-wrap">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          disabled={retryPending}
          // Neutral inside the red frame: the error is the alarming part, retrying is not.
          className="bg-background/75 hover:bg-background text-foreground mt-1.5 inline-flex items-center gap-1 rounded-full border px-2 py-0.75 text-[10px] font-medium transition-colors disabled:opacity-60"
        >
          {retryPending ? (
            <Loader2 className="size-2.5 shrink-0 animate-spin" />
          ) : (
            <RotateCcw className="size-2.5 shrink-0" />
          )}
          {retryPending ? 'Retrying…' : 'Retry'}
        </button>
      ) : null}
    </div>
  )
}

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
  /** Client context (e.g. the sender's current window) attached to this message for the model. */
  contextLines?: string[]
  /** Session-private attachments that accompanied this user message. */
  attachments?: SessionAttachmentInfo[]
}

/**
 * Resolves `attachment://<id>` links in a user message's blocks to displayable `data:` URLs by
 * fetching the session-private attachment bytes from the agent server. Blocks pass through
 * untouched while the fetch is in flight or when the message has no attachments.
 */
function useAttachmentResolvedBlocks(
  serverUrl: string | undefined,
  message: ChatBubbleMessage,
): HMBlockNode[] | undefined {
  const accountId = useSelectedAccountId()
  const attachmentIds = useMemo(() => (message.attachments ?? []).map((info) => info.id), [message.attachments])
  const srcById = useSessionAttachmentDataUrls(serverUrl, accountId, message.sessionId, attachmentIds)
  return useMemo(() => {
    if (!message.blocks?.length || Object.keys(srcById).length === 0) return message.blocks
    return substituteAttachmentLinks(message.blocks, srcById)
  }, [message.blocks, srcById])
}

function substituteAttachmentLinks(blocks: HMBlockNode[], srcById: Record<string, string>): HMBlockNode[] {
  return blocks.map((node) => {
    let block = node.block
    const link = (block as {link?: unknown}).link
    if (typeof link === 'string' && link.startsWith('attachment://')) {
      const src = srcById[link.slice('attachment://'.length)]
      if (src) block = {...block, link: src} as typeof node.block
    }
    const children = node.children?.length ? substituteAttachmentLinks(node.children, srcById) : node.children
    return {...node, block, children}
  })
}

/**
 * Info chip on a user bubble whose send carried window context.
 *
 * The context itself never renders as message text — it is model-facing — but the user must be
 * able to see exactly what the agent was told about what they were looking at. The chip opens a
 * popover with the verbatim lines.
 */
function MessageContextInfo({lines}: {lines: string[]}) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground mt-1.5 flex items-center gap-1 rounded-full border border-current/20 px-1.5 py-0.5 text-[10px] opacity-80"
          title="What the agent was told about your current window"
        >
          <Info className="size-3" />
          Context
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 max-w-[90vw] p-3">
        <div className="text-muted-foreground mb-2 text-xs font-medium">Context shared with the agent</div>
        <pre className="bg-muted max-h-64 overflow-auto rounded-md p-2 font-mono text-[11px] whitespace-pre-wrap">
          {lines.join('\n')}
        </pre>
      </PopoverContent>
    </Popover>
  )
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

function formatToolDebugValue(value: unknown): string {
  if (value === undefined) return '(none)'
  if (typeof value === 'string') return value

  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function ToolChip({children, tone}: {children: React.ReactNode; tone?: 'error'}) {
  return (
    <span
      className={`rounded-full border px-1.5 py-0.5 text-[9px] font-medium whitespace-nowrap ${
        tone === 'error'
          ? 'border-destructive/30 bg-destructive/10 text-destructive'
          : 'bg-background/75 text-muted-foreground border'
      }`}
    >
      {children}
    </span>
  )
}

/**
 * Which world a row's subject came from — memory, an hm doc, the web — in the row's quiet corner.
 * Mono so it reads as a label rather than as more sentence, and never a link: the subject beside
 * it is the thing you click.
 */
function ToolSourceChip({children}: {children: React.ReactNode}) {
  return (
    <span className="text-muted-foreground shrink-0 font-mono text-[9px] tracking-wide whitespace-nowrap opacity-80">
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
      onClick={(event) => {
        event.stopPropagation()
        openUrl(url, event.metaKey || event.shiftKey)
      }}
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
      onClick={(event) => {
        event.stopPropagation()
        openUrl(url, event.metaKey || event.shiftKey)
      }}
      className="text-foreground font-medium decoration-1 underline-offset-2 hover:underline"
    >
      {children}
    </button>
  )
}

/**
 * Where a tool row sits — which agent, on which server — so a memory path or a thread id in a
 * summary or a detail knows where it leads. Context rather than props: the address links live deep
 * inside the detail views, and threading three ids through every one of them would be noise.
 */
const ToolRowContext = React.createContext<{serverUrl?: string; accountUid?: string | null; agentId?: string}>({})

/** Opens an address target the way the app opens everything else, honouring cmd/shift-click. */
function useToolLinkOpener() {
  const {serverUrl, agentId} = React.useContext(ToolRowContext)
  const openUrl = useOpenUrl()
  const clickNavigate = useClickNavigate()

  return {
    /** False when the target needs context this row does not have — the label stays plain text. */
    canOpen(target: ToolLinkTarget | undefined): target is ToolLinkTarget {
      if (!target) return false
      if (target.type === 'url') return true
      if (target.type === 'session') return !!serverUrl
      return !!agentId
    },
    open(target: ToolLinkTarget, event: React.MouseEvent) {
      if (target.type === 'url') {
        openUrl(target.url, event.metaKey || event.shiftKey)
        return
      }
      if (target.type === 'session') {
        clickNavigate({key: 'agent-session', sessionId: target.sessionId, serverUrl}, event as never)
        return
      }
      if (!agentId) return
      const route =
        target.type === 'memory'
          ? {key: 'agent' as const, agentId, serverUrl, tab: 'memory' as const, memoryPath: target.path}
          : {key: 'agent' as const, agentId, serverUrl, tab: 'tools' as const}
      clickNavigate(route, event as never)
    },
  }
}

/**
 * A tool row's subject as a way in: the memory file opens the Memory tab at that file, the document
 * opens the document, the thread opens its transcript. Styled identically wherever it appears, and
 * it swallows the click so the row still expands from everywhere else.
 */
function ToolLinkText({
  target,
  label,
  title,
  className,
}: {
  target?: ToolLinkTarget
  label: string
  title?: string
  className?: string
}) {
  const {canOpen, open} = useToolLinkOpener()

  if (!canOpen(target)) {
    return (
      <span title={title} className={cn('min-w-0 truncate', className)}>
        {label}
      </span>
    )
  }

  return (
    <button
      type="button"
      title={title ?? label}
      onClick={(event) => {
        event.stopPropagation()
        open(target, event)
      }}
      className={cn(
        'text-foreground min-w-0 truncate text-left font-medium decoration-1 underline-offset-2 hover:underline',
        className,
      )}
    >
      {label}
    </button>
  )
}

/** A detail value that is itself an address renders as the link it is, not as flat text. */
function ToolDetailText({value}: {value: string}) {
  const target = detailLinkTarget(value)
  return target ? (
    <ToolLinkText target={target} label={value} title={value} className="font-normal" />
  ) : (
    <span className="break-words">{value}</span>
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
          {typeof item.args?.script === 'string' && item.args.script ? (
            <div className="min-h-0 space-y-1">
              <div className="text-muted-foreground text-[10px] font-medium tracking-[0.18em] uppercase">Script</div>
              <pre className="bg-muted max-h-64 overflow-auto rounded-xl p-3 font-mono text-[11px] whitespace-pre">
                {item.args.script}
              </pre>
            </div>
          ) : null}
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

/**
 * The metadata a row renders by.
 *
 * A `call` row is really a row about the tool it called: `Call · execute` names the mechanism and
 * hides the act, so the called tool's own label, icon, links and details drive the row — with its
 * input-side paths rebased onto `call`'s nested `input`.
 */
function getRowToolMetadata(item: ChatToolPart): SeedToolMetadata | undefined {
  if (item.name !== 'call') return getSeedTool(item.name)
  const called = getToolString(item.args, 'tool')
  const metadata = called ? getSeedTool(called) : undefined
  if (!metadata) return getSeedTool(item.name)
  const nest = (path?: string) => (path ? `input.${path}` : 'input')
  const {render} = metadata
  return {
    ...metadata,
    render: {
      ...render,
      primaryArg: render.primaryArg ? nest(render.primaryArg) : undefined,
      summaryArg: render.summaryArg ? nest(render.summaryArg) : undefined,
      links: render.links?.map((link) => (link.source === 'input' ? {...link, path: nest(link.path)} : link)),
      details: render.details?.map((detail) =>
        detail.source === 'input' ? {...detail, path: nest(detail.path)} : detail,
      ),
    },
  }
}

function getToolLinks(item: ChatToolPart) {
  const metadata = getRowToolMetadata(item)
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

function getToolSummary(item: ChatToolPart): string | undefined {
  if (item.summaryOverride) return item.summaryOverride
  const metadata = getRowToolMetadata(item)
  const outputSummary = firstInlinePathValue(item.rawOutput, metadata?.render.summaryOutputPath)
  if (outputSummary) return outputSummary

  const inputSummary = firstInlinePathValue(item.args, metadata?.render.summaryArg || metadata?.render.primaryArg)
  if (inputSummary) return inputSummary

  return item.result
}

function getToolDetails(item: ChatToolPart) {
  const metadata = getRowToolMetadata(item)
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

function getToolCustomView(item: ChatToolPart) {
  const command = getToolString(item.args, 'command') || getToolString(item.rawOutput, 'command')
  return getSeedTool(item.name)?.render.customViews?.find((view) => view.command === command)
}

function isHMBlockNodeArray(value: unknown): value is HMBlockNode[] {
  return Array.isArray(value) && value.every((item) => isRecord(item) && isRecord(item.block))
}

function parseToolBlocks(value: unknown, format?: string): HMBlockNode[] | undefined {
  if (isHMBlockNodeArray(value)) return value
  if (typeof value !== 'string' || format !== 'json') return undefined

  try {
    const parsed = JSON.parse(value)
    return isHMBlockNodeArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
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

function commentInfoFromRecordId(recordId: string | undefined): {targetUrl: string; commentUrl: string} | undefined {
  if (!isCommentRecordId(recordId)) return undefined
  const normalized = recordId.replace(/^hm:\/\//, '')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length < 2) return undefined
  const targetUrl = `hm://${parts.slice(0, -1).join('/')}`
  return {targetUrl, commentUrl: buildCommentUrl(targetUrl, normalized)}
}

function buildProfileUrl(publicKey: string | undefined): string | undefined {
  if (!publicKey) return undefined
  if (publicKey.startsWith('hm://')) return publicKey
  return `hm://${publicKey}/:profile`
}

function getWriteCommand(item: ChatToolPart): string | undefined {
  return getFirstToolString(item.args, ['command']) || getFirstToolString(item.rawOutput, ['command'])
}

function getWriteDocumentName(item: ChatToolPart, fallback = 'Untitled'): string {
  return (
    getFirstToolString(item.rawOutput, ['metadata.name', 'title']) ||
    // The write verb carries the title in options; the pre-verb commands carried it in input.
    getFirstToolString(item.args, [
      'options.title',
      'input.name',
      'input.title',
      'name',
      'title',
      'input.path',
      'path',
    ]) ||
    fallback
  )
}

function getWriteContent(item: ChatToolPart): {label: string; markdown?: string; blocks?: HMBlockNode[]} | undefined {
  const command = getWriteCommand(item)
  const label = command?.startsWith('comment.') ? 'Comment' : 'Content'
  const outputMarkdown = getFirstToolString(item.rawOutput, ['markdown'])
  if (outputMarkdown) return {label, markdown: outputMarkdown}

  const format = getFirstToolString(item.args, ['input.format', 'format'])
  const rawInputContent =
    getFirstToolValue(item.args, ['input.body', 'input.text', 'body', 'text', 'input.content', 'content']) ??
    getFirstToolValue(item.rawOutput, ['content'])
  const blocks = parseToolBlocks(rawInputContent, format)
  if (blocks) return {label, blocks}
  if (typeof rawInputContent === 'string' && rawInputContent) return {label, markdown: rawInputContent}
  return undefined
}

function getWriteMetadata(item: ChatToolPart): unknown {
  return getFirstToolValue(item.rawOutput, ['metadata']) ?? getFirstToolValue(item.args, ['input.metadata', 'metadata'])
}

function getWritePrimaryDocumentUrl(item: ChatToolPart): string | undefined {
  const command = getWriteCommand(item)
  if (command === 'document.move') {
    return (
      getFirstToolString(item.rawOutput, ['destination', 'ref.id']) ||
      getFirstToolString(item.args, [
        'input.destination',
        'input.destinationId',
        'destination',
        'destinationId',
        'input.to',
        'to',
      ])
    )
  }
  if (command === 'document.redirect') {
    return (
      getFirstToolString(item.rawOutput, ['target']) ||
      getFirstToolString(item.args, ['input.to', 'to', 'input.target', 'target'])
    )
  }
  if (command === 'draft.publish') {
    return getFirstToolString(item.rawOutput, ['id'])
  }
  return (
    getFirstToolString(item.rawOutput, ['url', 'resourceUrl', 'id', 'destination', 'target']) ||
    getFirstToolString(item.args, ['input.edit', 'edit', 'input.id', 'id', 'input.target', 'target', 'address'])
  )
}

function getWriteSourceDocumentUrl(item: ChatToolPart): string | undefined {
  return (
    getFirstToolString(item.rawOutput, ['redirect.id']) ||
    getFirstToolString(item.args, ['input.source', 'input.sourceId', 'source', 'sourceId', 'input.id', 'id'])
  )
}

function getWriteDestinationDocumentUrl(item: ChatToolPart): string | undefined {
  return (
    getFirstToolString(item.rawOutput, ['destination', 'ref.id', 'target']) ||
    getFirstToolString(item.args, [
      'input.destination',
      'input.destinationId',
      'destination',
      'destinationId',
      'input.to',
      'to',
      'input.target',
      'target',
    ])
  )
}

function getCommentLinks(item: ChatToolPart) {
  const output = item.rawOutput
  const targetUrl = getFirstToolString(output, ['targetUrl', 'target'])
  const commentRecordId = [
    getFirstToolString(output, ['commentUrl']),
    getFirstToolString(output, ['commentRecordId', 'commentId']),
    getFirstToolString(item.args, ['input.comment', 'input.commentId', 'comment', 'commentId']),
  ]
  const rawCommentUrl = isCommentUrlForRecordId(commentRecordId[0]) ? commentRecordId[0] : undefined
  const fallbackRecord = commentInfoFromRecordId(commentRecordId[1]) || commentInfoFromRecordId(commentRecordId[2])
  const commentUrl =
    rawCommentUrl ||
    (targetUrl && isCommentRecordId(commentRecordId[1])
      ? buildCommentUrl(targetUrl, commentRecordId[1])
      : fallbackRecord?.commentUrl)
  const resolvedTargetUrl = targetUrl || fallbackRecord?.targetUrl
  return {commentUrl, targetUrl: resolvedTargetUrl}
}

function ToolDetailSection({label, children}: {label: string; children: React.ReactNode}) {
  return (
    <div className="space-y-1.5">
      <div className="text-muted-foreground text-[10px] font-medium tracking-[0.18em] uppercase">{label}</div>
      {children}
    </div>
  )
}

function ToolDetailCard({children}: {children: React.ReactNode}) {
  return <div className="bg-background/60 text-foreground rounded-md border px-2.5 py-2">{children}</div>
}

function ToolDetailList({children}: {children: React.ReactNode}) {
  return <div className="grid gap-1.5 sm:grid-cols-2">{children}</div>
}

function ToolDetailItem({label, children}: {label: string; children: React.ReactNode}) {
  return (
    <div className="min-w-0 space-y-0.5">
      <div className="text-muted-foreground text-[10px]">{label}</div>
      <div className="min-w-0 text-[12px] break-words">{children}</div>
    </div>
  )
}

function ToolEntityText({url, label}: {url?: string; label: string}) {
  return url ? <ToolTextLink url={url}>{label}</ToolTextLink> : <span>{label}</span>
}

function ToolRenderedContent({content}: {content: {markdown?: string; blocks?: HMBlockNode[]}}) {
  if (content.blocks?.length) {
    return (
      <div className="text-foreground rounded-md bg-transparent px-1 py-0.5 [&_.ProseMirror]:!bg-transparent [&_.bn-container]:!bg-transparent [&_.bn-editor]:!bg-transparent [&_.hm-prose]:!font-sans [&_.hm-prose]:!text-base">
        <Suspense fallback={<pre className="text-[11px] whitespace-pre-wrap">Loading rich content…</pre>}>
          <RichMessageBlocks blocks={content.blocks} />
        </Suspense>
      </div>
    )
  }

  return <Markdown>{content.markdown || ''}</Markdown>
}

/**
 * The one-line account of an address-shaped verb: what happened, to what — the thing named the way
 * its own source names it, and clickable — with the source chip riding at the row's edge.
 *
 * `override` is a workflow's own narration of the call ("Checking the pricing page"); it replaces
 * the derived verb and label but keeps the address's link and chip, so the row still goes somewhere.
 */
function AddressToolSummary({summary, override}: {summary: ToolRowSummary; override?: string}) {
  return (
    <span className="text-foreground/80 flex min-w-0 flex-1 items-baseline gap-1 overflow-hidden">
      {override ? null : <span className="shrink-0 font-medium">{summary.verb}</span>}
      <ToolLinkText target={summary.target} label={override ?? summary.label} title={summary.title} />
      {summary.detail ? <span className="text-foreground/55 shrink truncate">{summary.detail}</span> : null}
    </span>
  )
}

/** One entry of a memory listing, as a way straight into that file. */
function MemoryEntryLink({entry}: {entry: Record<string, unknown>}) {
  const path = typeof entry.path === 'string' ? entry.path : undefined
  if (!path) return null
  const isDir = entry.type === 'dir'
  const size = typeof entry.size === 'number' ? entry.size : undefined
  return (
    <div className="flex min-w-0 items-baseline gap-2 text-[12px]">
      <ToolLinkText
        target={{type: 'memory', path}}
        label={isDir ? `${path}/` : path}
        title={`~/memory/${path}`}
        className="font-normal"
      />
      {size !== undefined && !isDir ? (
        <span className="text-muted-foreground shrink-0 text-[10px]">{size} bytes</span>
      ) : null}
    </div>
  )
}

/**
 * What a read actually returned, led by WHERE it came from: the address as a link, the source's own
 * facts beside it, then the content — a document's markdown, a memory listing's entries as links.
 */
function ReadToolDetails({item}: {item: ChatToolPart}) {
  const address = toolCallAddress(item) ?? ''
  const summary = resolveToolRowSummary(item)
  const output = item.rawOutput
  const resourceUrl = getFirstToolString(output, ['id', 'resourceUrl'])
  const requestedUrl = getFirstToolString(output, ['requestedId'])
  const server = getToolString(output, 'server')
  const mimeType = getToolString(output, 'mimeType')
  const markdown = getToolString(output, 'markdown')
  // A memory file is text, not markdown — it keeps its own line breaks instead of being formatted.
  const fileContent = markdown ? undefined : getToolString(output, 'content')
  const entries = getPathValues(output, 'entries[]').filter(isRecord)

  return (
    <div className="space-y-3">
      <ToolDetailSection label="Source">
        <ToolDetailCard>
          <ToolDetailList>
            <ToolDetailItem label="Address">
              <ToolDetailText value={address} />
            </ToolDetailItem>
            {summary && summary.label !== address ? (
              <ToolDetailItem label="Name">
                <ToolLinkText target={summary.target} label={summary.label} title={summary.title} />
              </ToolDetailItem>
            ) : null}
            {resourceUrl && resourceUrl !== address ? (
              <ToolDetailItem label="Resolved">
                <ToolDetailText value={resourceUrl} />
              </ToolDetailItem>
            ) : null}
            {requestedUrl && requestedUrl !== address && requestedUrl !== resourceUrl ? (
              <ToolDetailItem label="Requested">
                <ToolDetailText value={requestedUrl} />
              </ToolDetailItem>
            ) : null}
            {server ? <ToolDetailItem label="Server">{server}</ToolDetailItem> : null}
            {mimeType ? <ToolDetailItem label="Type">{mimeType}</ToolDetailItem> : null}
          </ToolDetailList>
        </ToolDetailCard>
      </ToolDetailSection>
      {entries.length ? (
        <ToolDetailSection label="Entries">
          <ToolDetailCard>
            <div className="max-h-72 space-y-0.5 overflow-auto">
              {entries.map((entry) => (
                <MemoryEntryLink key={String(entry.path)} entry={entry} />
              ))}
            </div>
          </ToolDetailCard>
        </ToolDetailSection>
      ) : null}
      {markdown ? (
        <ToolDetailSection label="Content">
          <ToolDetailCard>
            <div className="max-h-72 overflow-auto">
              <Markdown>{markdown}</Markdown>
            </div>
          </ToolDetailCard>
        </ToolDetailSection>
      ) : null}
      {fileContent ? (
        <ToolDetailSection label="Content">
          <ToolOutputPre>{fileContent}</ToolOutputPre>
        </ToolDetailSection>
      ) : null}
    </div>
  )
}

/**
 * A write that is not one of the hypermedia commands — a memory file, an IPFS publish, an authored
 * tool — told as destination first, then exactly what was written there.
 */
function WriteAddressDetails({item}: {item: ChatToolPart}) {
  const address = toolCallAddress(item) ?? ''
  const summary = resolveToolRowSummary(item)
  const output = item.rawOutput
  const path = getToolString(output, 'path')
  const url = getFirstToolString(output, ['url', 'id'])
  const size = getFirstToolValue(output, ['size'])
  const options = getFirstToolValue(item.args, ['options'])
  const content = getToolString(item.args, 'content')

  return (
    <div className="space-y-3">
      <ToolDetailSection label="Destination">
        <ToolDetailCard>
          <ToolDetailList>
            <ToolDetailItem label="Address">
              <ToolDetailText value={address} />
            </ToolDetailItem>
            {summary && summary.label !== address ? (
              <ToolDetailItem label="Wrote">
                <ToolLinkText target={summary.target} label={summary.label} title={summary.title} />
              </ToolDetailItem>
            ) : null}
            {path && path !== summary?.label ? (
              <ToolDetailItem label="Path">
                <ToolDetailText value={`~/memory/${path}`} />
              </ToolDetailItem>
            ) : null}
            {url ? (
              <ToolDetailItem label="URL">
                <ToolDetailText value={url} />
              </ToolDetailItem>
            ) : null}
            {typeof size === 'number' ? <ToolDetailItem label="Size">{`${size} bytes`}</ToolDetailItem> : null}
          </ToolDetailList>
        </ToolDetailCard>
      </ToolDetailSection>
      {content ? (
        <ToolDetailSection label="Content">
          <ToolOutputPre>{content}</ToolOutputPre>
        </ToolDetailSection>
      ) : null}
      {isRecord(options) && Object.keys(options).length ? (
        <ToolDetailSection label="Options">
          <ToolOutputPre>{formatToolDebugValue(options)}</ToolOutputPre>
        </ToolDetailSection>
      ) : null}
    </div>
  )
}

function WriteCommandSummary({item}: {item: ChatToolPart}) {
  const command = getWriteCommand(item)
  const output = item.rawOutput
  const documentUrl = getWritePrimaryDocumentUrl(item)
  const documentName = getWriteDocumentName(item, labelFromUrl(documentUrl, 'Untitled'))
  const sourceUrl = getWriteSourceDocumentUrl(item)
  const destinationUrl = getWriteDestinationDocumentUrl(item)
  const sourceName = labelFromUrl(sourceUrl, 'source')
  const destinationName = labelFromUrl(destinationUrl, 'destination')
  const draftTitle =
    getFirstToolString(output, ['title']) || getFirstToolString(item.args, ['input.name', 'name']) || 'Untitled'
  const draftId =
    getFirstToolString(output, ['draftId']) ||
    getFirstToolString(item.args, ['input.draftId', 'draftId', 'input.draft', 'draft'])
  const profileName =
    getFirstToolString(output, ['profile.name', 'signer.profileName']) ||
    getFirstToolString(item.args, ['input.name', 'name']) ||
    'Profile'
  const profilePublicKey = getFirstToolString(output, ['profile.publicKey', 'signer.publicKey'])
  const profileUrl = buildProfileUrl(profilePublicKey)
  const alias =
    getFirstToolString(output, ['alias']) || getFirstToolString(item.args, ['input.alias', 'alias']) || 'alias'
  const contactName =
    getFirstToolString(output, ['name']) || getFirstToolString(item.args, ['input.name', 'name']) || 'Contact'
  const contactSubject =
    getFirstToolString(output, ['subject']) || getFirstToolString(item.args, ['input.subject', 'subject'])
  const contactSubjectUrl = buildProfileUrl(contactSubject)
  const capabilityRole =
    getFirstToolString(output, ['role']) || getFirstToolString(item.args, ['input.role', 'role']) || 'Capability'
  const capabilityDelegate =
    getFirstToolString(output, ['delegate']) ||
    getFirstToolString(item.args, ['input.delegate', 'delegate', 'input.delegateUid', 'delegateUid'])
  const capabilityDelegateUrl = buildProfileUrl(capabilityDelegate)
  const {commentUrl, targetUrl} = getCommentLinks(item)
  const authorPublicKey = getFirstToolString(output, ['authorUrl', 'signer.publicKey'])
  const authorUrl = authorPublicKey?.startsWith('hm://') ? authorPublicKey : buildProfileUrl(authorPublicKey)
  const authorName = getFirstToolString(output, ['authorName', 'signer.profileName']) || authorPublicKey || 'Author'
  const targetName = getFirstToolString(output, ['targetName']) || labelFromUrl(targetUrl, 'document')

  switch (command) {
    case 'comment.create':
      return (
        <span className="text-foreground/80 min-w-0 truncate">
          {commentUrl ? (
            <ToolTextLink url={commentUrl}>New Comment</ToolTextLink>
          ) : (
            <span className="font-medium">New Comment</span>
          )}{' '}
          by <ToolEntityText url={authorUrl} label={authorName} /> on{' '}
          <ToolEntityText url={targetUrl} label={targetName} />
        </span>
      )
    case 'comment.update':
      return (
        <span className="text-foreground/80 min-w-0 truncate">
          <span className="font-medium">Update comment</span>
          {targetUrl ? (
            <>
              {' '}
              on <ToolEntityText url={targetUrl} label={targetName} />
            </>
          ) : null}
        </span>
      )
    case 'comment.delete':
      return (
        <span className="text-foreground/80 min-w-0 truncate">
          <span className="font-medium">Delete comment</span>
          {targetUrl ? (
            <>
              {' '}
              on <ToolEntityText url={targetUrl} label={targetName} />
            </>
          ) : null}
        </span>
      )
    case 'document.create':
      return (
        <span className="text-foreground/80 min-w-0 truncate">
          <span className="font-medium">Create document:</span>{' '}
          <ToolEntityText url={documentUrl} label={documentName} />
        </span>
      )
    case 'document.update':
      return (
        <span className="text-foreground/80 min-w-0 truncate">
          <span className="font-medium">Update document:</span>{' '}
          <ToolEntityText url={documentUrl} label={documentName} />
        </span>
      )
    case 'document.delete':
      return (
        <span className="text-foreground/80 min-w-0 truncate">
          <span className="font-medium">Delete document:</span>{' '}
          <ToolEntityText url={documentUrl} label={documentName} />
        </span>
      )
    case 'document.fork':
      return (
        <span className="text-foreground/80 min-w-0 truncate">
          <span className="font-medium">Copy document:</span>{' '}
          <ToolEntityText url={destinationUrl || documentUrl} label={destinationName} />
        </span>
      )
    case 'document.ref':
      return (
        <span className="text-foreground/80 min-w-0 truncate">
          <span className="font-medium">Reference document:</span>{' '}
          <ToolEntityText url={destinationUrl || documentUrl} label={destinationName} />
        </span>
      )
    case 'document.move':
      return (
        <span className="text-foreground/80 min-w-0 truncate">
          <span className="font-medium">Move document:</span> <ToolEntityText url={sourceUrl} label={sourceName} /> →{' '}
          <ToolEntityText url={destinationUrl} label={destinationName} />
        </span>
      )
    case 'document.redirect':
      return (
        <span className="text-foreground/80 min-w-0 truncate">
          <span className="font-medium">Redirect document:</span> <ToolEntityText url={sourceUrl} label={sourceName} />{' '}
          → <ToolEntityText url={destinationUrl} label={destinationName} />
        </span>
      )
    case 'draft.create':
      return (
        <span className="text-foreground/80 min-w-0 truncate">
          <span className="font-medium">Create draft:</span> {draftTitle}
        </span>
      )
    case 'draft.update':
      return (
        <span className="text-foreground/80 min-w-0 truncate">
          <span className="font-medium">Update draft:</span> {draftTitle}
        </span>
      )
    case 'draft.get':
      return (
        <span className="text-foreground/80 min-w-0 truncate">
          <span className="font-medium">Open draft:</span> {draftTitle}
        </span>
      )
    case 'draft.list':
      return (
        <span className="text-foreground/80 min-w-0 truncate">
          <span className="font-medium">List drafts</span>
        </span>
      )
    case 'draft.delete':
      return (
        <span className="text-foreground/80 min-w-0 truncate">
          <span className="font-medium">Delete draft:</span> {draftTitle || draftId || 'Draft'}
        </span>
      )
    case 'draft.publish':
      return (
        <span className="text-foreground/80 min-w-0 truncate">
          <span className="font-medium">Publish draft:</span> {draftTitle}
          {documentUrl ? (
            <>
              {' '}
              → <ToolEntityText url={documentUrl} label={documentName} />
            </>
          ) : null}
        </span>
      )
    case 'profile.update':
      return (
        <span className="text-foreground/80 min-w-0 truncate">
          <span className="font-medium">Update profile:</span> <ToolEntityText url={profileUrl} label={profileName} />
        </span>
      )
    case 'profile.alias':
      return (
        <span className="text-foreground/80 min-w-0 truncate">
          <span className="font-medium">Alias profile:</span> {alias}
        </span>
      )
    case 'contact.create':
      return (
        <span className="text-foreground/80 min-w-0 truncate">
          <span className="font-medium">Create contact:</span>{' '}
          <ToolEntityText url={contactSubjectUrl} label={contactName} />
        </span>
      )
    case 'contact.delete':
      return (
        <span className="text-foreground/80 min-w-0 truncate">
          <span className="font-medium">Delete contact:</span> {contactName}
        </span>
      )
    case 'capability.create':
    case 'capability.grant':
      return (
        <span className="text-foreground/80 min-w-0 truncate">
          <span className="font-medium">Grant {capabilityRole} capability</span>
          {capabilityDelegate ? (
            <>
              {' '}
              to <ToolEntityText url={capabilityDelegateUrl} label={capabilityDelegate} />
            </>
          ) : null}
        </span>
      )
    default:
      return (
        <span className="text-foreground/80 min-w-0 truncate">
          <span className="font-medium">{command || 'Write'}</span>
          {documentUrl ? (
            <>
              : <ToolEntityText url={documentUrl} label={documentName} />
            </>
          ) : null}
        </span>
      )
  }
}

function WriteCommandDetails({item}: {item: ChatToolPart}) {
  const command = getWriteCommand(item)
  const content = getWriteContent(item)
  const metadata = getWriteMetadata(item)
  const output = item.rawOutput
  const warning = getFirstToolString(output, ['warning'])
  const dryRun = getFirstToolValue(output, ['dryRun']) === true
  const documentUrl = getWritePrimaryDocumentUrl(item)
  const documentName = getWriteDocumentName(item, labelFromUrl(documentUrl, 'Untitled'))
  const sourceUrl = getWriteSourceDocumentUrl(item)
  const destinationUrl = getWriteDestinationDocumentUrl(item)
  const sourceName = labelFromUrl(sourceUrl, 'source')
  const destinationName = labelFromUrl(destinationUrl, 'destination')
  const draftId =
    getFirstToolString(output, ['draftId']) ||
    getFirstToolString(item.args, ['input.draftId', 'draftId', 'input.draft', 'draft'])
  const draftTitle =
    getFirstToolString(output, ['title']) || getFirstToolString(item.args, ['input.name', 'name']) || 'Untitled'
  const profileName =
    getFirstToolString(output, ['profile.name', 'signer.profileName']) ||
    getFirstToolString(item.args, ['input.name', 'name']) ||
    'Profile'
  const profilePublicKey = getFirstToolString(output, ['profile.publicKey', 'signer.publicKey'])
  const profileUrl = buildProfileUrl(profilePublicKey)
  const alias = getFirstToolString(output, ['alias']) || getFirstToolString(item.args, ['input.alias', 'alias'])
  const contactId =
    getFirstToolString(output, ['contactId']) || getFirstToolString(item.args, ['input.contactId', 'contactId'])
  const contactName =
    getFirstToolString(output, ['name']) || getFirstToolString(item.args, ['input.name', 'name']) || 'Contact'
  const contactSubject =
    getFirstToolString(output, ['subject']) || getFirstToolString(item.args, ['input.subject', 'subject'])
  const contactSubjectUrl = buildProfileUrl(contactSubject)
  const capabilityRole = getFirstToolString(output, ['role']) || getFirstToolString(item.args, ['input.role', 'role'])
  const capabilityDelegate =
    getFirstToolString(item.args, ['input.delegate', 'delegate', 'input.delegateUid', 'delegateUid']) ||
    getFirstToolString(output, ['delegate'])
  const capabilityDelegateUrl = buildProfileUrl(capabilityDelegate)
  const capabilityPath = getFirstToolString(output, ['path']) || getFirstToolString(item.args, ['input.path', 'path'])
  const capabilityLabel =
    getFirstToolString(output, ['label']) || getFirstToolString(item.args, ['input.label', 'label'])
  const version = getFirstToolString(output, ['version'])
  const status = getFirstToolString(output, ['status'])
  const {commentUrl, targetUrl} = getCommentLinks(item)
  const targetName = getFirstToolString(output, ['targetName']) || labelFromUrl(targetUrl, 'document')
  const authorPublicKey = getFirstToolString(output, ['authorUrl', 'signer.publicKey'])
  const authorUrl = authorPublicKey?.startsWith('hm://') ? authorPublicKey : buildProfileUrl(authorPublicKey)
  const authorName = getFirstToolString(output, ['authorName', 'signer.profileName']) || authorPublicKey || 'Author'
  const drafts = getPathValues(output, 'drafts[]').filter((draft) => isRecord(draft)) as Record<string, unknown>[]

  return (
    <div className="space-y-3">
      {dryRun || warning ? (
        <ToolDetailSection label="Status">
          <ToolDetailCard>
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              {dryRun ? <ToolChip>Dry run</ToolChip> : null}
              {status ? <ToolChip>{status}</ToolChip> : null}
              {warning ? <span className="text-amber-700 dark:text-amber-300">{warning}</span> : null}
            </div>
          </ToolDetailCard>
        </ToolDetailSection>
      ) : null}

      {command === 'comment.create' || command === 'comment.update' || command === 'comment.delete' ? (
        <ToolDetailSection label="Comment">
          <ToolDetailCard>
            <ToolDetailList>
              <ToolDetailItem label="Comment">
                {commentUrl ? <ToolTextLink url={commentUrl}>{commentUrl}</ToolTextLink> : 'Comment thread'}
              </ToolDetailItem>
              <ToolDetailItem label="Document">
                <ToolEntityText url={targetUrl} label={targetName} />
              </ToolDetailItem>
              {command === 'comment.create' ? (
                <ToolDetailItem label="Author">
                  <ToolEntityText url={authorUrl} label={authorName} />
                </ToolDetailItem>
              ) : null}
            </ToolDetailList>
          </ToolDetailCard>
        </ToolDetailSection>
      ) : null}

      {command === 'document.create' || command === 'document.update' || command === 'document.delete' ? (
        <ToolDetailSection label="Document">
          <ToolDetailCard>
            <ToolDetailList>
              <ToolDetailItem label="Document">
                <ToolEntityText url={documentUrl} label={documentName} />
              </ToolDetailItem>
              {version ? <ToolDetailItem label="Version">{version}</ToolDetailItem> : null}
            </ToolDetailList>
          </ToolDetailCard>
        </ToolDetailSection>
      ) : null}

      {command === 'document.fork' ||
      command === 'document.ref' ||
      command === 'document.move' ||
      command === 'document.redirect' ? (
        <ToolDetailSection label="Document change">
          <ToolDetailCard>
            <ToolDetailList>
              {sourceUrl ? (
                <ToolDetailItem label="Source">
                  <ToolEntityText url={sourceUrl} label={sourceName} />
                </ToolDetailItem>
              ) : null}
              {destinationUrl ? (
                <ToolDetailItem label={command === 'document.redirect' ? 'Target' : 'Destination'}>
                  <ToolEntityText url={destinationUrl} label={destinationName} />
                </ToolDetailItem>
              ) : null}
              {version ? <ToolDetailItem label="Version">{version}</ToolDetailItem> : null}
            </ToolDetailList>
          </ToolDetailCard>
        </ToolDetailSection>
      ) : null}

      {command === 'draft.create' ||
      command === 'draft.update' ||
      command === 'draft.get' ||
      command === 'draft.delete' ||
      command === 'draft.publish' ? (
        <ToolDetailSection label="Draft">
          <ToolDetailCard>
            <ToolDetailList>
              <ToolDetailItem label="Title">{draftTitle}</ToolDetailItem>
              {draftId ? <ToolDetailItem label="Draft ID">{draftId}</ToolDetailItem> : null}
              {documentUrl && command === 'draft.publish' ? (
                <ToolDetailItem label="Published document">
                  <ToolEntityText url={documentUrl} label={documentName} />
                </ToolDetailItem>
              ) : null}
              {status ? <ToolDetailItem label="Status">{status}</ToolDetailItem> : null}
            </ToolDetailList>
          </ToolDetailCard>
        </ToolDetailSection>
      ) : null}

      {command === 'draft.list' && drafts.length ? (
        <ToolDetailSection label="Drafts">
          <div className="space-y-2">
            {drafts.map((draft) => (
              <ToolDetailCard key={String(draft.id || draft.title || Math.random())}>
                <ToolDetailList>
                  <ToolDetailItem label="Title">
                    {typeof draft.title === 'string' && draft.title ? draft.title : 'Untitled draft'}
                  </ToolDetailItem>
                  <ToolDetailItem label="Status">
                    {typeof draft.status === 'string' ? draft.status : 'idle'}
                  </ToolDetailItem>
                  {typeof draft.edit_target === 'string' && draft.edit_target ? (
                    <ToolDetailItem label="Edit target">{draft.edit_target}</ToolDetailItem>
                  ) : null}
                  {typeof draft.location_target === 'string' && draft.location_target ? (
                    <ToolDetailItem label="Location">{draft.location_target}</ToolDetailItem>
                  ) : null}
                </ToolDetailList>
              </ToolDetailCard>
            ))}
          </div>
        </ToolDetailSection>
      ) : null}

      {command === 'profile.update' || command === 'profile.alias' ? (
        <ToolDetailSection label="Profile">
          <ToolDetailCard>
            <ToolDetailList>
              <ToolDetailItem label="Profile">
                <ToolEntityText url={profileUrl} label={profileName} />
              </ToolDetailItem>
              {alias ? <ToolDetailItem label="Alias">{alias}</ToolDetailItem> : null}
            </ToolDetailList>
          </ToolDetailCard>
        </ToolDetailSection>
      ) : null}

      {command === 'contact.create' || command === 'contact.delete' ? (
        <ToolDetailSection label="Contact">
          <ToolDetailCard>
            <ToolDetailList>
              <ToolDetailItem label="Contact">{contactName}</ToolDetailItem>
              {contactSubject ? (
                <ToolDetailItem label="Profile">
                  <ToolEntityText url={contactSubjectUrl} label={contactSubject} />
                </ToolDetailItem>
              ) : null}
              {contactId ? <ToolDetailItem label="Contact ID">{contactId}</ToolDetailItem> : null}
            </ToolDetailList>
          </ToolDetailCard>
        </ToolDetailSection>
      ) : null}

      {command === 'capability.create' || command === 'capability.grant' ? (
        <ToolDetailSection label="Capability">
          <ToolDetailCard>
            <ToolDetailList>
              {capabilityRole ? <ToolDetailItem label="Role">{capabilityRole}</ToolDetailItem> : null}
              {capabilityDelegate ? (
                <ToolDetailItem label="Delegate">
                  <ToolEntityText url={capabilityDelegateUrl} label={capabilityDelegate} />
                </ToolDetailItem>
              ) : null}
              {capabilityPath ? <ToolDetailItem label="Path">{capabilityPath}</ToolDetailItem> : null}
              {capabilityLabel ? <ToolDetailItem label="Label">{capabilityLabel}</ToolDetailItem> : null}
            </ToolDetailList>
          </ToolDetailCard>
        </ToolDetailSection>
      ) : null}

      {content ? (
        <ToolDetailSection label={content.label}>
          <ToolDetailCard>
            <div className="max-h-72 overflow-auto">
              <ToolRenderedContent content={content} />
            </div>
          </ToolDetailCard>
        </ToolDetailSection>
      ) : null}

      {metadata && isRecord(metadata) && Object.keys(metadata).length > 0 ? (
        <ToolDetailSection label="Metadata">
          <pre className="bg-background/60 text-foreground max-h-72 overflow-auto rounded-md border p-2 text-[11px] whitespace-pre-wrap">
            {formatToolDebugValue(metadata)}
          </pre>
        </ToolDetailSection>
      ) : null}
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

/** Last few non-empty lines of a live output tail. */
function lastOutputLines(outputTail: string, maxLines: number): string {
  return outputTail
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .slice(-maxLines)
    .join('\n')
}

function formatDurationMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

function ToolOutputPre({children, className}: {children: React.ReactNode; className?: string}) {
  return (
    <pre
      className={cn(
        'bg-background/60 text-foreground max-h-72 overflow-auto rounded-md border p-2 font-mono text-[11px] leading-4 whitespace-pre-wrap',
        className,
      )}
    >
      {children}
    </pre>
  )
}

/**
 * Purpose-built expanded view for execute_code: the code as code, output/errors as
 * terminal-style text with newlines intact, a compact result line — no raw JSON (the
 * info button's debug dialog still has the raw payloads).
 */
function ExecuteCodeDetails({item, liveTail}: {item: ChatToolPart; liveTail?: string}) {
  // Old transcripts: execute_code {language, code}. New transcripts: call {tool: 'execute', input: {runtime, code}}.
  const code = getToolString(item.args, 'code') ?? getToolString(item.args, 'input.code')
  const language =
    getToolString(item.args, 'language') ??
    getToolString(item.args, 'input.runtime') ??
    getToolString(item.args, 'runtime')
  const output = isRecord(item.rawOutput) ? item.rawOutput : undefined
  const stdout = typeof output?.stdout === 'string' ? output.stdout : undefined
  const stderr = typeof output?.stderr === 'string' ? output.stderr : undefined
  const exitCode = typeof output?.exitCode === 'number' ? output.exitCode : undefined
  const durationMs = typeof output?.durationMs === 'number' ? output.durationMs : undefined
  const changedFiles = Array.isArray(output?.changedFiles)
    ? (output.changedFiles.filter(isRecord) as {path?: unknown; change?: unknown}[])
    : []

  return (
    <div className="space-y-3">
      <ToolDetailSection label={language ? `Code · ${language}` : 'Code'}>
        <ToolOutputPre className="whitespace-pre">{code || '(no code)'}</ToolOutputPre>
      </ToolDetailSection>
      {liveTail ? (
        <ToolDetailSection label="Output · live">
          <ToolOutputPre>{liveTail}</ToolOutputPre>
        </ToolDetailSection>
      ) : null}
      {output ? (
        <>
          {stdout?.trim() ? (
            <ToolDetailSection label="Output">
              <ToolOutputPre>{stdout}</ToolOutputPre>
            </ToolDetailSection>
          ) : null}
          {stderr?.trim() ? (
            <ToolDetailSection label="Errors">
              <ToolOutputPre className="text-amber-800 dark:text-amber-200">{stderr}</ToolOutputPre>
            </ToolDetailSection>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <ToolChip>{output.success === true ? 'Success' : `Failed · exit ${exitCode ?? '?'}`}</ToolChip>
            {durationMs !== undefined ? <ToolChip>{formatDurationMs(durationMs)}</ToolChip> : null}
            {output.truncated === true ? <ToolChip>Output truncated</ToolChip> : null}
            {changedFiles.map((file) => (
              <ToolChip key={String(file.path)}>
                {String(file.change)} {String(file.path)}
              </ToolChip>
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}

/** Delegation rows across eras: the verb, plus the two pre-collapse tool names in old transcripts. */
function isDelegateToolName(name: string): boolean {
  return name === 'delegate' || name === 'sub_session' || name === 'run_workflow'
}

/**
 * The expanded delegate bubble: the briefing the child was given, the work it did, and what it
 * came back with — with the raw payloads and the script source behind the ⓘ dialog.
 *
 * The brief leads, because it is the one part that always exists: a child that is still working
 * has no run record to show yet (the run is not linked to the tool call until it reports back),
 * and a legacy record may have only a transcript. Every one of those states still says something
 * true rather than spinning forever.
 */
function DelegateWorkDetails({
  item,
  serverUrl,
  accountUid,
}: {
  item: ChatToolPart
  serverUrl?: string
  accountUid?: string | null
}) {
  // The panel does not thread a signing account through its bubbles, and the delegate view is the
  // only consumer that needs one — so it asks for itself rather than degrading silently.
  const selectedAccountId = useSelectedAccountId()
  const signingAccount = accountUid || selectedAccountId
  const runId = getToolString(item.rawOutput, 'runId')
  const sessionId = getToolSessionId(item)
  const brief = getToolString(item.args, 'brief')
  const isPending = item.result === undefined && item.rawOutput === undefined
  const typedOutput = getFirstToolValue(item.rawOutput, ['output'])

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {brief ? (
        <ToolDetailSection label="Brief">
          <ToolDetailCard>
            <div className="max-h-72 overflow-auto">
              <Markdown>{brief}</Markdown>
            </div>
          </ToolDetailCard>
        </ToolDetailSection>
      ) : null}

      {serverUrl && signingAccount && runId ? (
        <DelegateRunView serverUrl={serverUrl} accountUid={signingAccount} runId={runId} />
      ) : isPending ? (
        <div className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
          <Loader2 className="size-3 shrink-0 animate-spin" />
          {sessionId ? 'The child is working — open its transcript to watch.' : 'Starting the child…'}
        </div>
      ) : null}

      {typedOutput !== undefined ? (
        <ToolDetailSection label="Result">
          <ToolOutputPre className="whitespace-pre-wrap">{formatToolDebugValue(typedOutput)}</ToolOutputPre>
        </ToolDetailSection>
      ) : null}

      {sessionId && serverUrl ? <OpenTranscriptLink sessionId={sessionId} serverUrl={serverUrl} /> : null}
    </div>
  )
}

/** The way into a child's own transcript, honouring cmd/shift-click like every other session row. */
function OpenTranscriptLink({sessionId, serverUrl}: {sessionId: string; serverUrl: string}) {
  const clickNavigate = useClickNavigate()
  return (
    <button
      type="button"
      className="text-primary self-start text-[11px] hover:underline"
      onClick={(event) => clickNavigate({key: 'agent-session', sessionId, serverUrl}, event)}
    >
      Open transcript →
    </button>
  )
}

/** The child run's own account of its work — the same hierarchy the run card shows. */
function DelegateRunView({serverUrl, accountUid, runId}: {serverUrl: string; accountUid: string; runId: string}) {
  const navigate = useNavigate()
  const direct = useRun(serverUrl, accountUid, runId)
  const seed = direct.data ?? undefined
  // A finished run never changes again: no socket, no tree query, on a transcript full of them.
  const isLive = !!seed && !isTerminalRun(seed.status)
  const {runsById, liveState} = useRunTreeView(serverUrl, accountUid, seed?.rootRunId, seed, isLive)
  const focus = seed ? runsById[seed.id] ?? seed : undefined
  const children = useMemo(() => (focus ? descendantsOf(runsById, focus.id) : []), [runsById, focus?.id])

  if (!focus) {
    return direct.isLoading ? <div className="text-muted-foreground text-[11px]">Loading the child run…</div> : null
  }
  return (
    <RunWorkHierarchy
      run={focus}
      childRuns={children}
      plan={focus.plan}
      journal={liveState.journal}
      liveState={liveState}
      compact
      onOpenSession={(childSessionId) => navigate({key: 'agent-session', sessionId: childSessionId, serverUrl})}
      renderToolPart={(part) => (
        <ToolCallLine item={part} serverUrl={serverUrl} accountUid={accountUid} agentId={focus.agentId} />
      )}
    />
  )
}

/**
 * The transcript a delegation call created, once it has one. (`sub_session` covers transcripts
 * recorded before the verb collapse.)
 *
 * Present in the result and in the spawn placeholder, so the title is a way in while the
 * child is still working, not only after it finishes.
 */
function getToolSessionId(item: ChatToolPart): string | undefined {
  if (item.name !== 'delegate' && item.name !== 'sub_session') return undefined
  return getToolString(item.rawOutput, 'sessionId')
}

/**
 * A tool row's title, as a way into what it made.
 *
 * Styled as the document titles in read/write rows are, and it swallows the click the same way, so
 * the rest of the row still expands.
 */
function ToolRouteLink({
  label,
  title,
  onOpen,
}: {
  label: string
  title: string
  onOpen: (event: React.MouseEvent) => void
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={(event) => {
        // Opening and expanding are different intents; the row's toggle must not also fire.
        event.stopPropagation()
        onOpen(event)
      }}
      className="text-foreground min-w-0 truncate font-medium decoration-1 underline-offset-2 hover:underline"
    >
      {label}
    </button>
  )
}

export function ToolCallLine({
  item,
  liveActivity,
  serverUrl,
  accountUid,
  agentId,
}: {
  item: ChatToolPart
  liveActivity?: AgentRunActivity
  /** Agent server the run lives on; without it the embedded run record cannot be loaded. */
  serverUrl?: string
  /** Signing account for server-side queries; without it the delegate work view falls back to raw details. */
  accountUid?: string | null
  /** The agent whose memory and tools these addresses belong to, so its rows link into them. */
  agentId?: string
}) {
  const [expanded, setExpanded] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const clickNavigate = useClickNavigate()
  const childSessionId = getToolSessionId(item)
  const metadata = getRowToolMetadata(item)
  const render = metadata?.render
  const Icon = toolIcons[render?.kind || 'generic']
  const isPending = item.result === undefined && item.rawOutput === undefined
  const details = getToolDetails(item)
  const summary = getToolSummary(item)
  const links = getToolLinks(item)
  const addressSummary = resolveToolRowSummary(item)
  const sourceChip = addressSummary?.chip ?? toolRowSourceChip(item)
  const colorClass = item.isError
    ? 'border-destructive/30 bg-destructive/5'
    : toolColorClasses[render?.color || 'muted']
  const customView = getToolCustomView(item)
  const rowContext = useMemo(() => ({serverUrl, accountUid, agentId}), [serverUrl, accountUid, agentId])
  // Live progress for this specific call while it runs (matched by call ID, with a
  // tool-name fallback for servers that don't report the ID yet).
  const liveTool =
    isPending &&
    liveActivity?.phase === 'tool' &&
    (liveActivity.toolCallId ? liveActivity.toolCallId === item.id : liveActivity.toolName === item.name)
      ? liveActivity
      : undefined
  const liveTailPreview = liveTool?.outputTail ? lastOutputLines(liveTool.outputTail, 10) : ''

  return (
    <ToolRowContext.Provider value={rowContext}>
      <div className={cn('my-1.5 mr-6 rounded-lg border px-2 py-1.5 text-xs', colorClass)}>
        {/* The whole header row toggles expansion; inner links/buttons stop propagation. */}
        <div
          className="flex min-w-0 cursor-pointer items-center gap-1.5 select-none"
          onClick={() => setExpanded((current) => !current)}
        >
          <button
            type="button"
            title={expanded ? 'Hide tool details' : 'Show tool details'}
            aria-expanded={expanded}
            onClick={(event) => {
              event.stopPropagation()
              setExpanded((current) => !current)
            }}
            className="hover:bg-background/70 rounded p-0.5"
          >
            {expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          </button>
          {isPending ? <Loader2 className="size-3 shrink-0 animate-spin" /> : <Icon className="size-3 shrink-0" />}
          {item.actor === 'user' ? (
            <span className="border-primary/40 bg-primary/10 text-primary shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[9px] font-medium tracking-wide uppercase">
              You
            </span>
          ) : null}
          {/* Hypermedia writes keep their purpose-built phrasing (a comment, a move, a grant read
              nothing like "wrote"); every other address gets the resolved one-liner. */}
          {customView?.kind === 'write-command' && !item.summaryOverride ? (
            <WriteCommandSummary item={item} />
          ) : addressSummary ? (
            <AddressToolSummary summary={addressSummary} override={item.summaryOverride} />
          ) : (
            <>
              <span className="shrink-0 font-medium">{render?.label || item.name}</span>
              {summary ? (
                childSessionId && serverUrl ? (
                  <ToolRouteLink
                    label={summary}
                    title={`Open ${summary}`}
                    // clickNavigate honours cmd/shift-click into a new window, like every other
                    // session row in the app.
                    onOpen={(event) =>
                      clickNavigate({key: 'agent-session', sessionId: childSessionId, serverUrl}, event)
                    }
                  />
                ) : (
                  <span className="text-foreground/75 min-w-0 truncate">{summary}</span>
                )
              ) : null}
              {liveTool?.detail ? <span className="text-foreground/60 min-w-0 truncate">{liveTool.detail}</span> : null}
              <div className="flex min-w-0 shrink-0 items-center gap-1 overflow-hidden">
                {links.map((link) => (
                  <ToolResourceLink key={link.url} url={link.url} label={link.label} />
                ))}
              </div>
            </>
          )}
          {/* One quiet marker of where this came from, then the row's state, then the raw payload. */}
          <div className="ml-auto flex shrink-0 items-center gap-1.5">
            {sourceChip ? <ToolSourceChip>{sourceChip}</ToolSourceChip> : null}
            {isPending ? <ToolChip>{render?.pendingLabel || 'Running'}</ToolChip> : null}
            {item.isError ? <ToolChip tone="error">Failed</ToolChip> : null}
            {getFirstToolValue(item.rawOutput, ['dryRun']) === true ? <ToolChip>Dry run</ToolChip> : null}
            <button
              type="button"
              title="View raw tool input/output"
              onClick={(event) => {
                event.stopPropagation()
                setDetailsOpen(true)
              }}
              className="hover:bg-background/70 text-muted-foreground hover:text-foreground bg-background/60 rounded-full border p-0.75"
            >
              <Info className="size-3" />
            </button>
          </div>
        </div>
        {!expanded && liveTailPreview ? (
          <pre className="bg-background/60 text-foreground/80 mt-1.5 overflow-hidden rounded-md border p-2 font-mono text-[10px] leading-4 break-all whitespace-pre-wrap">
            {liveTailPreview}
          </pre>
        ) : null}
        {expanded ? (
          <div className="mt-2 space-y-2 border-t pt-2">
            {item.isError && item.result ? (
              <pre className="border-destructive/30 bg-destructive/5 text-destructive max-h-48 overflow-auto rounded-md border p-2 text-[11px] whitespace-pre-wrap">
                {item.result}
              </pre>
            ) : null}
            {isDelegateToolName(item.name) ? (
              <DelegateWorkDetails item={item} serverUrl={serverUrl} accountUid={accountUid} />
            ) : item.name === 'execute_code' ||
              (item.name === 'call' && getToolString(item.args, 'tool') === 'execute') ? (
              <ExecuteCodeDetails item={item} liveTail={liveTool?.outputTail} />
            ) : item.name === 'read' && addressSummary ? (
              <ReadToolDetails item={item} />
            ) : customView?.kind === 'write-command' ? (
              <WriteCommandDetails item={item} />
            ) : item.name === 'write' && addressSummary ? (
              <WriteAddressDetails item={item} />
            ) : (
              <>
                {details.map((detail) => (
                  <div key={`${detail.label}:${detail.path || detail.source}`} className="space-y-1">
                    <div className="text-muted-foreground text-[10px] font-medium tracking-[0.18em] uppercase">
                      {detail.label}
                    </div>
                    {detail.format === 'markdown' && typeof detail.value === 'string' ? (
                      <div className="bg-background/60 text-foreground max-h-72 overflow-auto rounded-md border px-2.5 py-2">
                        <Markdown>{detail.value}</Markdown>
                      </div>
                    ) : typeof detail.value === 'string' && detailLinkTarget(detail.value) ? (
                      // A detail that IS an address is a way in, not a string to read.
                      <ToolDetailCard>
                        <ToolDetailText value={detail.value} />
                      </ToolDetailCard>
                    ) : (
                      <pre className="bg-background/60 text-foreground max-h-72 overflow-auto rounded-md border p-2 text-[11px] whitespace-pre-wrap">
                        {formatToolDebugValue(detail.value)}
                      </pre>
                    )}
                  </div>
                ))}
                {liveTool?.outputTail ? (
                  <ToolDetailSection label="Output · live">
                    <ToolOutputPre>{liveTool.outputTail}</ToolOutputPre>
                  </ToolDetailSection>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </div>
      <ToolCallDebugDialog item={item} open={detailsOpen} onOpenChange={setDetailsOpen} />
    </ToolRowContext.Provider>
  )
}

function ToolCallItem({
  item,
  liveActivity,
  serverUrl,
  accountUid,
  agentId,
}: {
  item: ChatToolPart
  liveActivity?: AgentRunActivity
  serverUrl?: string
  accountUid?: string | null
  agentId?: string
}) {
  return (
    <ToolCallLine
      item={item}
      liveActivity={liveActivity}
      serverUrl={serverUrl}
      accountUid={accountUid}
      agentId={agentId}
    />
  )
}
