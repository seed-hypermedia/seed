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
  const command = getToolString(item.args, 'command') || getToolString(item.rawOutput, 'command')
  return getSeedToolMetadata(item.name)?.render.customViews?.find((view) => view.command === command)
}

function getFirstToolString(value: unknown, paths: string[]): string | undefined {
  for (const path of paths) {
    const found = getToolString(value, path)
    if (found) return found
  }
  return undefined
}

function getFirstToolValue(value: unknown, paths: string[]): unknown {
  for (const path of paths) {
    const found = getPathValues(value, path)[0]
    if (found !== undefined) return found
  }
  return undefined
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

function labelFromUrl(url: string | undefined, fallback = 'document'): string {
  if (!url) return fallback
  const normalized = url.replace(/^hm:\/\//, '').split(/[?#]/)[0]
  const parts = normalized.split('/').filter(Boolean)
  if (parts[1] === ':profile') return parts[0] || fallback
  return parts.at(-1) || fallback
}

function getWriteCommand(item: ChatToolPart): string | undefined {
  return getFirstToolString(item.args, ['command']) || getFirstToolString(item.rawOutput, ['command'])
}

function getWriteDocumentName(item: ChatToolPart, fallback = 'Untitled'): string {
  return (
    getFirstToolString(item.rawOutput, ['metadata.name', 'title']) ||
    getFirstToolString(item.args, ['input.name', 'input.title', 'name', 'title', 'input.path', 'path']) ||
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
    getFirstToolString(item.args, ['input.edit', 'edit', 'input.id', 'id', 'input.target', 'target'])
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

function ReadToolSummary({item}: {item: ChatToolPart}) {
  const output = item.rawOutput
  const resourceUrl = getFirstToolString(output, ['resourceUrl', 'id']) || getFirstToolString(item.args, ['id'])
  const title =
    getFirstToolString(output, ['title', 'displayLabel']) ||
    getFirstToolString(item.args, ['id']) ||
    labelFromUrl(resourceUrl, 'Document')

  return (
    <span className="text-foreground/80 min-w-0 truncate">
      <span className="font-medium">Read document:</span> <ToolEntityText url={resourceUrl} label={title} />
    </span>
  )
}

function ReadToolDetails({item}: {item: ChatToolPart}) {
  const output = item.rawOutput
  const resourceUrl = getFirstToolString(output, ['resourceUrl', 'id']) || getFirstToolString(item.args, ['id'])
  const requestedUrl = getFirstToolString(output, ['requestedId']) || getFirstToolString(item.args, ['id'])
  const title = getFirstToolString(output, ['title', 'displayLabel']) || labelFromUrl(resourceUrl, 'Document')
  const server = getFirstToolString(output, ['server'])
  const markdown = getFirstToolString(output, ['markdown'])

  return (
    <div className="space-y-3">
      <ToolDetailSection label="Document">
        <ToolDetailCard>
          <ToolDetailList>
            <ToolDetailItem label="Title">
              <ToolEntityText url={resourceUrl} label={title} />
            </ToolDetailItem>
            {server ? <ToolDetailItem label="Server">{server}</ToolDetailItem> : null}
            {requestedUrl && requestedUrl !== resourceUrl ? (
              <ToolDetailItem label="Requested">{requestedUrl}</ToolDetailItem>
            ) : null}
          </ToolDetailList>
        </ToolDetailCard>
      </ToolDetailSection>
      {markdown ? (
        <ToolDetailSection label="Content">
          <ToolDetailCard>
            <div className="max-h-72 overflow-auto">
              <Markdown>{markdown}</Markdown>
            </div>
          </ToolDetailCard>
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
          {item.name === 'read' ? (
            <ReadToolSummary item={item} />
          ) : customView?.kind === 'write-command' ? (
            <WriteCommandSummary item={item} />
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
          {getFirstToolValue(item.rawOutput, ['dryRun']) === true ? <ToolChip>Dry run</ToolChip> : null}
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
            {item.name === 'read' ? (
              <ReadToolDetails item={item} />
            ) : customView?.kind === 'write-command' ? (
              <WriteCommandDetails item={item} />
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
