/**
 * What a tool row says, and where its words go when clicked.
 *
 * The five verbs are address-polymorphic: `read {address}` is a memory file, a hypermedia document,
 * a web page, an attachment, a thread. A row that says "Read document: document" tells the user
 * nothing, so every read/write row resolves its address ONCE here — into the thing's own name, the
 * source it came from, and the place a click should land — and both the chat transcript and the run
 * hierarchy render that same resolution.
 *
 * This module is deliberately free of React and of the agents protocol's rendering internals: it is
 * data in, data out, so the phrasing is unit-testable without a DOM.
 */
import type {ChatToolPart} from './chat-parts'

// ------------------------------------------------------------------------------------------------
// Value picking — the shared way every renderer reaches into tool input/output
// ------------------------------------------------------------------------------------------------

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** Every value at a dotted path; `key[]` spreads an array of records. */
export function getPathValues(value: unknown, path?: string): unknown[] {
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

/** A one-line rendering of a scalar; arrays collapse to a count, objects are not inlined. */
export function formatInlineValue(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`
  return undefined
}

export function firstInlinePathValue(value: unknown, path?: string): string | undefined {
  for (const item of getPathValues(value, path)) {
    const formatted = formatInlineValue(item)
    if (formatted) return formatted
  }
  return undefined
}

export function getToolString(value: unknown, path: string): string | undefined {
  const found = getPathValues(value, path)[0]
  return typeof found === 'string' && found ? found : undefined
}

export function getFirstToolString(value: unknown, paths: string[]): string | undefined {
  for (const path of paths) {
    const found = getToolString(value, path)
    if (found) return found
  }
  return undefined
}

export function getFirstToolValue(value: unknown, paths: string[]): unknown {
  for (const path of paths) {
    const found = getPathValues(value, path)[0]
    if (found !== undefined) return found
  }
  return undefined
}

/** Long URLs elide their middle so the row stays one line. */
export function shortUrlLabel(url: string): string {
  if (url.length <= 34) return url
  return `${url.slice(0, 18)}…${url.slice(-12)}`
}

/** The last meaningful segment of an hm:// URL — an account's profile shows the account. */
export function labelFromUrl(url: string | undefined, fallback = 'document'): string {
  if (!url) return fallback
  const normalized = url.replace(/^hm:\/\//, '').split(/[?#]/)[0] ?? ''
  const parts = normalized.split('/').filter(Boolean)
  if (parts[1] === ':profile') return parts[0] || fallback
  return parts.at(-1) || fallback
}

// ------------------------------------------------------------------------------------------------
// Addresses
// ------------------------------------------------------------------------------------------------

/** Where an address points, which decides both the chip and the click. */
export type ToolAddressKind =
  | 'memory'
  | 'tools'
  | 'hm'
  | 'web'
  | 'ipfs'
  | 'activity'
  | 'attachment'
  | 'thread'
  | 'run'
  | 'unknown'

/** Where a row's label navigates. Undefined when the address has nowhere to go. */
export type ToolLinkTarget =
  | {type: 'url'; url: string}
  | {type: 'memory'; path: string}
  | {type: 'session'; sessionId: string}
  | {type: 'tools'}

export type ParsedToolAddress = {
  kind: ToolAddressKind
  /** The address as the user would name it, before any output-supplied title. */
  display: string
  /** Mono source chip at the row's right edge. */
  chip: string
  address: string
  /** Memory path without its `~/memory/` prefix; '' is the memory root. */
  memoryPath?: string
  /** True for `~/memory/dir/` and `~/memory` — a listing rather than a file. */
  isDirectory?: boolean
  /** Tool name for `~/tools/<name>`; absent for the `~/tools` listing. */
  toolName?: string
  /** The id part of `attachment:`/`thread:`/`run:` addresses. */
  id?: string
}

const CHIP_BY_KIND: Record<ToolAddressKind, string> = {
  memory: 'memory',
  tools: 'tools',
  hm: 'hm doc',
  web: 'web',
  ipfs: 'ipfs',
  activity: 'activity',
  attachment: 'attachment',
  thread: 'thread',
  run: 'run',
  unknown: '',
}

/** `bun.sh/blog/bun-v1.2` — host plus a trimmed path, which is how people name a web page. */
function webDisplay(address: string): string {
  try {
    const url = new URL(address)
    const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '')
    const full = `${url.host}${path}`
    return full.length <= 40 ? full : `${url.host}${path.slice(0, 24)}…`
  } catch {
    return shortUrlLabel(address)
  }
}

function shortCid(cid: string): string {
  return cid.length <= 18 ? cid : `${cid.slice(0, 8)}…${cid.slice(-6)}`
}

/** Reads one verb address into the parts a row needs: what it is, what to call it, where it goes. */
export function parseToolAddress(rawAddress: string): ParsedToolAddress {
  const address = rawAddress.trim()
  const of = (kind: ToolAddressKind, display: string, extra?: Partial<ParsedToolAddress>) => ({
    kind,
    display,
    chip: CHIP_BY_KIND[kind],
    address,
    ...extra,
  })

  if (address === '~/memory' || address === '~/memory/') {
    return of('memory', 'memory root', {memoryPath: '', isDirectory: true})
  }
  if (address.startsWith('~/memory/')) {
    const path = address.slice('~/memory/'.length)
    const isDirectory = path.endsWith('/')
    const clean = path.replace(/\/+$/, '')
    return of('memory', clean || 'memory root', {memoryPath: clean, isDirectory})
  }
  if (address === '~/tools' || address === '~/tools/') return of('tools', 'all tools')
  if (address.startsWith('~/tools/')) {
    const toolName = address.slice('~/tools/'.length).replace(/\/+$/, '')
    return of('tools', toolName || 'all tools', {toolName: toolName || undefined})
  }
  if (address.startsWith('hm://')) return of('hm', labelFromUrl(address))
  if (address.startsWith('ipfs://')) return of('ipfs', shortCid(address.slice('ipfs://'.length)))
  if (address.startsWith('activity:')) return of('activity', 'activity feed')
  if (address.startsWith('attachment:')) {
    const id = address.slice('attachment:'.length)
    return of('attachment', id, {id})
  }
  if (address.startsWith('thread:')) {
    const id = address.slice('thread:'.length)
    return of('thread', id, {id})
  }
  if (address.startsWith('run:')) {
    const id = address.slice('run:'.length)
    return of('run', `run ${shortCid(id)}`, {id})
  }
  if (/^https?:\/\//.test(address)) return of('web', webDisplay(address))
  return of('unknown', address ? shortUrlLabel(address) : '')
}

/** Where an address itself links, before any output-supplied resource URL refines it. */
function targetFor(parsed: ParsedToolAddress): ToolLinkTarget | undefined {
  if (parsed.kind === 'memory') return {type: 'memory', path: parsed.memoryPath ?? ''}
  if (parsed.kind === 'tools') return {type: 'tools'}
  if (parsed.kind === 'thread' && parsed.id) return {type: 'session', sessionId: parsed.id}
  if (parsed.kind === 'hm' || parsed.kind === 'web') return {type: 'url', url: parsed.address}
  return undefined
}

// ------------------------------------------------------------------------------------------------
// Row summaries
// ------------------------------------------------------------------------------------------------

export type ToolRowSummary = {
  /** The leading bold word: what happened to the thing. */
  verb: string
  /** The thing itself, named the way its source names it. */
  label: string
  /** Where the label goes when clicked. */
  target?: ToolLinkTarget
  /** Muted trailing phrase: a destination, a count. */
  detail?: string
  /** Mono source chip at the row's right edge. */
  chip?: string
  /** Hover text — always the full address, however short the label got. */
  title: string
}

/** The address a read/write row acted on, across the verb era and the pre-verb tools. */
export function toolCallAddress(item: ChatToolPart): string | undefined {
  if (item.name !== 'read' && item.name !== 'write') return undefined
  return getFirstToolString(item.args, ['address', 'id', 'url', 'path'])
}

function pluralize(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

function countAt(output: unknown, path: string): number | undefined {
  const value = getPathValues(output, path)[0]
  return Array.isArray(value) ? value.length : undefined
}

function readSummary(item: ChatToolPart, parsed: ParsedToolAddress): ToolRowSummary {
  const output = item.rawOutput
  const base = {
    verb: 'Read',
    label: parsed.display,
    chip: parsed.chip,
    target: targetFor(parsed),
    title: parsed.address,
  }

  switch (parsed.kind) {
    case 'memory': {
      // A path without a trailing slash still answers with a listing when it is a directory.
      const entries = countAt(output, 'entries')
      if (parsed.isDirectory || entries !== undefined) {
        return {
          ...base,
          verb: 'Listed',
          detail: entries === undefined ? undefined : pluralize(entries, 'entry', 'entries'),
        }
      }
      return base
    }
    case 'tools':
      return parsed.toolName ? {...base, detail: 'contract'} : {...base, verb: 'Listed'}
    case 'hm': {
      const title = getFirstToolString(output, ['title', 'metadata.name'])
      const resourceUrl = getFirstToolString(output, ['id', 'resourceUrl']) ?? parsed.address
      return {...base, label: title || parsed.display, target: {type: 'url', url: resourceUrl}, title: resourceUrl}
    }
    case 'web': {
      // Seed sites resolve as hypermedia first: the output, not the URL, says which it turned out to be.
      if (getToolString(output, 'type') === 'hypermedia_document') {
        const title = getFirstToolString(output, ['title', 'metadata.name'])
        const resourceUrl = getFirstToolString(output, ['id']) ?? parsed.address
        return {...base, label: title || parsed.display, chip: CHIP_BY_KIND.hm, target: {type: 'url', url: resourceUrl}}
      }
      return base
    }
    case 'ipfs': {
      const path = getToolString(output, 'path')
      return {...base, verb: 'Fetched', detail: path ? `→ ${path}` : undefined}
    }
    case 'activity': {
      const events = countAt(output, 'events')
      return {...base, detail: events === undefined ? undefined : pluralize(events, 'event')}
    }
    case 'attachment': {
      const name = getToolString(output, 'name')
      return {...base, verb: getToolString(output, 'shownAsImage') ? 'Viewed' : 'Read', label: name || parsed.display}
    }
    case 'thread': {
      const title = getToolString(output, 'title')
      return {...base, label: title || parsed.display}
    }
    case 'run': {
      const status = getToolString(output, 'status')
      return {...base, detail: status}
    }
    default:
      return base
  }
}

function writeSummary(item: ChatToolPart, parsed: ParsedToolAddress): ToolRowSummary {
  const output = item.rawOutput
  const options = getFirstToolValue(item.args, ['options'])
  const base = {
    verb: 'Wrote',
    label: parsed.display,
    chip: parsed.chip,
    target: targetFor(parsed),
    title: parsed.address,
  }

  switch (parsed.kind) {
    case 'memory': {
      const path = getToolString(output, 'path') ?? parsed.memoryPath ?? parsed.display
      const label = path || parsed.display
      const target: ToolLinkTarget = {type: 'memory', path}
      if (isRecord(options) && options.delete === true) return {...base, verb: 'Deleted', label, target}
      if (isRecord(options) && typeof options.fromUrl === 'string') {
        return {...base, verb: 'Downloaded', label, target, detail: `from ${webDisplay(options.fromUrl)}`}
      }
      if (isRecord(options) && typeof options.fromAttachment === 'string') {
        return {...base, verb: 'Saved', label, target, detail: 'from an attachment'}
      }
      return {...base, verb: 'Saved', label, target}
    }
    case 'tools': {
      const name = getToolString(output, 'name') ?? parsed.toolName ?? parsed.display
      const deleted = getPathValues(output, 'deleted')[0] === true
      return {...base, verb: deleted ? 'Deleted tool' : 'Saved tool', label: name, target: {type: 'tools'}}
    }
    case 'ipfs': {
      const url = getToolString(output, 'url')
      const source = getFirstToolString(output, ['path', 'name'])
      return {
        ...base,
        verb: 'Published',
        label: source || parsed.display,
        target: undefined,
        detail: url ? `→ ${shortCid(url.replace(/^ipfs:\/\//, ''))}` : undefined,
      }
    }
    case 'hm': {
      const title =
        getFirstToolString(output, ['metadata.name', 'name', 'title']) ||
        (isRecord(options) && typeof options.name === 'string' ? options.name : undefined) ||
        (isRecord(options) && typeof options.title === 'string' ? options.title : undefined) ||
        parsed.display
      const resourceUrl = getFirstToolString(output, ['id', 'url', 'resourceUrl']) ?? parsed.address
      const updating = isRecord(options) && options.action === 'update'
      return {
        ...base,
        verb: updating ? 'Updated' : 'Published',
        label: title,
        target: {type: 'url', url: resourceUrl},
        title: resourceUrl,
      }
    }
    default:
      return base
  }
}

/**
 * The one-line account of an address-shaped call: verb, the thing's own name, where it goes, and
 * which world it came from. Returns undefined for calls that are not address-shaped — those keep
 * their registry label and summary.
 */
export function resolveToolRowSummary(item: ChatToolPart): ToolRowSummary | undefined {
  const address = toolCallAddress(item)
  if (!address) return undefined
  const parsed = parseToolAddress(address)
  if (parsed.kind === 'unknown') return undefined
  return item.name === 'read' ? readSummary(item, parsed) : writeSummary(item, parsed)
}

/**
 * The source chip for any tool row, including the write commands that keep their own purpose-built
 * summary (a published document is still an `hm doc`).
 */
export function toolRowSourceChip(item: ChatToolPart): string | undefined {
  const address = toolCallAddress(item)
  if (address) {
    const parsed = parseToolAddress(address)
    if (parsed.kind === 'web' && getToolString(item.rawOutput, 'type') === 'hypermedia_document') {
      return CHIP_BY_KIND.hm
    }
    return parsed.chip || undefined
  }
  // Pre-verb transcripts: hypermedia writes carried a dotted command instead of an address.
  const command = getFirstToolString(item.args, ['command']) ?? getFirstToolString(item.rawOutput, ['command'])
  return command ? CHIP_BY_KIND.hm : undefined
}

/** A string worth rendering as a link in expanded details, rather than as flat text. */
export function detailLinkTarget(value: string): ToolLinkTarget | undefined {
  const trimmed = value.trim()
  if (!trimmed || /\s/.test(trimmed)) return undefined
  const parsed = parseToolAddress(trimmed)
  if (parsed.kind === 'unknown') return undefined
  return targetFor(parsed)
}
