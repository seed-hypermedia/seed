import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Download,
  ExternalLink,
  FileCode2,
  FileUp,
  GripVertical,
  Link2,
  MoreHorizontal,
  Plus,
  X,
} from 'lucide-react'
import {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react'
import {Button} from './button'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from './components/dropdown-menu'
import {Input} from './components/input'
import {Switch} from './components/switch'
import {Textarea} from './components/textarea'
import {base64ToBytes, bytesToBase64, formatByteSize, isDagJsonBytes, isDagJsonLink, parseCidString} from './dag-json'
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from './select-dropdown'
import {toast} from './toast'
import {Tooltip} from './tooltip'
import {cn} from './utils'
import {useSubschema} from './blob-schema-context'
import {HMEntityField} from './hm-entity-field'
import {
  EnumValueSelect,
  literalEnumOptions,
  SchemaFieldChips,
  SchemaWarningBadge,
  suggestedFieldType,
  useSchemaFieldSuggestions,
  useSchemaKeyLabel,
  type LiteralOption,
} from './value-editor-schema'

/**
 * Behavior rules for the recursive value editor, so it can serve both the
 * document metadata editor (attribute-publish constraints) and the raw
 * DAG-CBOR blob editor (full CBOR data model).
 */
export type ValueEditorRules = {
  /** Allow list values and the List add-type. */
  lists: boolean
  /** Allow non-integer numbers. */
  floats: boolean
  /**
   * How removing an object key behaves. 'tombstone' sets it to null (metadata
   * publish semantics — a missing key would never clear); 'delete' removes it.
   */
  removeKeys: 'tombstone' | 'delete'
  /** Hide null-valued object entries (metadata treats null as deleted). */
  hideNullEntries: boolean
  /** Allow IPLD kinds in DAG-JSON form: links `{"/": cid}` and bytes `{"/": {bytes}}`. */
  ipld: boolean
}

/** Rules for document metadata: what SetAttribute ops can publish. */
export const METADATA_VALUE_RULES: ValueEditorRules = {
  lists: false,
  floats: false,
  removeKeys: 'tombstone',
  hideNullEntries: true,
  ipld: false,
}

/** Rules for raw DAG-CBOR blobs: the full CBOR data model (as JSON types). */
export const CBOR_VALUE_RULES: ValueEditorRules = {
  lists: true,
  floats: true,
  removeKeys: 'delete',
  hideNullEntries: false,
  ipld: true,
}

/** Containers the editor recurses into — excludes the IPLD link/bytes leaf forms. */
function isEditableContainer(value: unknown): boolean {
  return (Array.isArray(value) || isPlainObject(value)) && !isDagJsonLink(value) && !isDagJsonBytes(value)
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const utf8 = new TextEncoder()

/**
 * Canonical map key order per the IPLD DAG-CBOR spec: shorter UTF-8 keys sort
 * first; equal-length keys compare bytewise.
 */
export function dagCborKeyCompare(a: string, b: string): number {
  const aBytes = utf8.encode(a)
  const bBytes = utf8.encode(b)
  if (aBytes.length !== bBytes.length) return aBytes.length - bBytes.length
  for (let i = 0; i < aBytes.length; i++) {
    if (aBytes[i] !== bBytes[i]) return aBytes[i]! - bBytes[i]!
  }
  return 0
}

/** Entries of an object in canonical DAG-CBOR key order. */
export function canonicalEntries(value: Record<string, unknown>, opts?: {hideNull?: boolean}): [string, unknown][] {
  return Object.entries(value)
    .filter(([, v]) => v !== undefined && (!opts?.hideNull || v !== null))
    .sort(([a], [b]) => dagCborKeyCompare(a, b))
}

/** Rebuild a value with all nested object keys in canonical order (for JSON display). */
export function toCanonicalOrder(value: unknown, opts?: {hideNull?: boolean}): unknown {
  if (Array.isArray(value)) return value.map((item) => toCanonicalOrder(item, opts))
  if (isPlainObject(value)) {
    return Object.fromEntries(canonicalEntries(value, opts).map(([k, v]) => [k, toCanonicalOrder(v, opts)]))
  }
  return value
}

/** Validate a value against the rules. Returns an error message or null. */
export function findInvalidValue(value: unknown, rules: ValueEditorRules, path: string[] = []): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'boolean') return null
  if (typeof value === 'number') {
    if (rules.floats) return Number.isFinite(value) ? null : `"${path.join('.')}" must be a finite number`
    return Number.isInteger(value) ? null : `"${path.join('.')}" must be a whole number`
  }
  if (isDagJsonLink(value)) {
    if (!rules.ipld) return `"${path.join('.')}" is an IPLD link — links cannot be published in metadata`
    return parseCidString(value['/']) ? null : `"${path.join('.')}" is not a valid CID link`
  }
  if (isDagJsonBytes(value)) {
    if (!rules.ipld) return `"${path.join('.')}" is IPLD bytes — bytes cannot be published in metadata`
    try {
      base64ToBytes(value['/'].bytes)
      return null
    } catch {
      return `"${path.join('.')}" has invalid base64 bytes`
    }
  }
  if (Array.isArray(value)) {
    if (!rules.lists) return `"${path.join('.')}" is a list — lists cannot be published in metadata`
    for (let i = 0; i < value.length; i++) {
      const problem = findInvalidValue(value[i], rules, [...path, String(i)])
      if (problem) return problem
    }
    return null
  }
  if (isPlainObject(value)) {
    for (const [key, child] of Object.entries(value)) {
      const problem = findInvalidValue(child, rules, [...path, key])
      if (problem) return problem
    }
    return null
  }
  return `"${path.join('.')}" has an unsupported type`
}

// No text-transform: keys are case-sensitive data, so they display verbatim.
export const FIELD_LABEL_CLASS = 'text-muted-foreground text-xs font-medium'
const NESTED_GROUP_CLASS = 'border-border ml-1 flex flex-col gap-1 border-l-2 pl-3'

// ---------------------------------------------------------------------------
// Undo history
// ---------------------------------------------------------------------------

const HISTORY_LIMIT = 200

/**
 * Snapshot-based undo/redo history. Call `record()` immediately BEFORE
 * applying an edit; `undo()`/`redo()` return the snapshot to restore, or null.
 */
export function useValueHistory<T>(current: T) {
  const currentRef = useRef(current)
  currentRef.current = current
  const undoStack = useRef<T[]>([])
  const redoStack = useRef<T[]>([])

  const record = useCallback(() => {
    undoStack.current.push(currentRef.current)
    if (undoStack.current.length > HISTORY_LIMIT) undoStack.current.shift()
    redoStack.current = []
  }, [])

  const undo = useCallback((): {value: T} | null => {
    if (undoStack.current.length === 0) return null
    const value = undoStack.current.pop()!
    redoStack.current.push(currentRef.current)
    return {value}
  }, [])

  const redo = useCallback((): {value: T} | null => {
    if (redoStack.current.length === 0) return null
    const value = redoStack.current.pop()!
    undoStack.current.push(currentRef.current)
    return {value}
  }, [])

  return {record, undo, redo}
}

// ---------------------------------------------------------------------------
// Selection, clipboard, context menu
// ---------------------------------------------------------------------------

export type ValuePath = (string | number)[]

function pathId(path: ValuePath): string {
  return JSON.stringify(path)
}

type SelectionHandlers = {
  getValue: () => unknown
  setValue: (value: unknown) => void
  remove?: () => void
  rules: ValueEditorRules
}

export type ContextMenuAction = {
  key: string
  label: string
  icon?: React.ReactNode
  destructive?: boolean
  onClick: () => void
}

type SelectionContextValue = {
  selectedId: string | null
  select: (id: string) => void
  clear: () => void
  register: (id: string, handlers: SelectionHandlers) => void
  unregister: (id: string) => void
  openContextMenu: (position: {x: number; y: number}, actions: ContextMenuAction[]) => void
  /** Opens ipfs://... URLs from link values, when the host page provides navigation. */
  openUrl?: (url: string) => void
}

const SelectionContext = createContext<SelectionContextValue | null>(null)

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest('input,textarea,select,[contenteditable="true"]')
}

/** Parse and validate clipboard-ish text for pasting. Non-JSON pastes as a string. */
function parsePastedText(text: string, rules: ValueEditorRules): {value: unknown} | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = text
  }
  const problem = findInvalidValue(parsed, rules)
  if (problem) {
    toast.error(`Cannot paste: ${problem}`)
    return null
  }
  return {value: parsed}
}

function copyValueToClipboard(value: unknown) {
  navigator.clipboard.writeText(JSON.stringify(toCanonicalOrder(value), null, 2))
  toast.success('Copied value')
}

async function pasteFromClipboard(handlers: SelectionHandlers) {
  let text: string
  try {
    text = await navigator.clipboard.readText()
  } catch {
    toast.error('Clipboard unavailable')
    return
  }
  if (!text) return
  const result = parsePastedText(text, handlers.rules)
  if (result) handlers.setValue(result.value)
}

/**
 * Enables row selection, clipboard, context menus, and undo shortcuts for all
 * value editors below it. Click a row to select it: Cmd/Ctrl+C copies the
 * value as JSON, Cmd/Ctrl+V pastes over it (validated), Delete removes it,
 * Escape deselects. Cmd/Ctrl+Z / Shift+Cmd/Ctrl+Z call onUndo/onRedo.
 */
export function ValueEditorProvider({
  children,
  onUndo,
  onRedo,
  openUrl,
}: {
  children: React.ReactNode
  onUndo?: () => void
  onRedo?: () => void
  openUrl?: (url: string) => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [menu, setMenu] = useState<{x: number; y: number; actions: ContextMenuAction[]} | null>(null)
  const registry = useRef(new Map<string, SelectionHandlers>())

  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId
  const undoRef = useRef(onUndo)
  undoRef.current = onUndo
  const redoRef = useRef(onRedo)
  redoRef.current = onRedo

  const ctx = useRef<SelectionContextValue>({
    selectedId: null,
    select: (id) => setSelectedId(id),
    clear: () => setSelectedId(null),
    register: (id, handlers) => registry.current.set(id, handlers),
    unregister: (id) => registry.current.delete(id),
    openContextMenu: (position, actions) => setMenu({...position, actions}),
  })
  ctx.current = {...ctx.current, selectedId, openUrl}

  useEffect(() => {
    const getSelectedHandlers = () => {
      const id = selectedIdRef.current
      return id ? registry.current.get(id) : undefined
    }

    const onCopy = (e: ClipboardEvent) => {
      if (isEditableTarget(e.target)) return
      // Don't hijack copying of regular text selections.
      if (document.getSelection()?.toString()) return
      const handlers = getSelectedHandlers()
      if (!handlers) return
      e.preventDefault()
      e.clipboardData?.setData('text/plain', JSON.stringify(toCanonicalOrder(handlers.getValue()), null, 2))
    }

    const onPaste = (e: ClipboardEvent) => {
      if (isEditableTarget(e.target)) return
      const handlers = getSelectedHandlers()
      if (!handlers) return
      const text = e.clipboardData?.getData('text/plain')
      if (!text) return
      e.preventDefault()
      const result = parsePastedText(text, handlers.rules)
      if (result) handlers.setValue(result.value)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        // Inputs keep their native text undo.
        if (isEditableTarget(e.target)) return
        const action = e.shiftKey ? redoRef.current : undoRef.current
        if (action) {
          e.preventDefault()
          action()
        }
        return
      }
      if (isEditableTarget(e.target)) return
      if (e.key === 'Escape') {
        setMenu(null)
        setSelectedId(null)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        const handlers = getSelectedHandlers()
        if (handlers?.remove) {
          e.preventDefault()
          handlers.remove()
          setSelectedId(null)
        }
      }
    }

    document.addEventListener('copy', onCopy)
    document.addEventListener('paste', onPaste)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('paste', onPaste)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  return (
    <SelectionContext.Provider value={ctx.current}>
      {children}
      {menu && (
        <div
          className="fixed inset-0 z-[100]"
          onClick={() => setMenu(null)}
          onContextMenu={(e) => {
            e.preventDefault()
            setMenu(null)
          }}
        >
          <div
            className="bg-popover text-popover-foreground absolute flex min-w-44 flex-col rounded-md border p-1 shadow-md"
            style={{
              left: Math.min(menu.x, typeof window !== 'undefined' ? window.innerWidth - 200 : menu.x),
              top: Math.min(
                menu.y,
                typeof window !== 'undefined' ? window.innerHeight - menu.actions.length * 34 - 12 : menu.y,
              ),
            }}
          >
            {menu.actions.map((action) => (
              <button
                key={action.key}
                type="button"
                className={cn(
                  'hover:bg-accent flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors',
                  action.destructive && 'text-destructive',
                )}
                onClick={() => {
                  setMenu(null)
                  action.onClick()
                }}
              >
                {action.icon}
                {action.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </SelectionContext.Provider>
  )
}

/** Row-level wiring for selection and the context menu. */
function useRowSelection(id: string, handlers: SelectionHandlers, getMenuActions: () => ContextMenuAction[]) {
  const ctx = useContext(SelectionContext)
  const isSelected = ctx?.selectedId === id

  // Keep the registry fresh with the latest value/handlers on every render.
  useEffect(() => {
    if (!ctx) return
    ctx.register(id, handlers)
    return () => ctx.unregister(id)
  })

  const onRowClick = ctx
    ? (e: React.MouseEvent) => {
        const target = e.target as HTMLElement
        if (target.closest('input,textarea,button,select,a,[contenteditable="true"],[role="combobox"]')) return
        e.stopPropagation()
        if (isSelected) ctx.clear()
        else ctx.select(id)
      }
    : undefined

  const onContextMenu = ctx
    ? (e: React.MouseEvent) => {
        // Right-click inside inputs keeps the native text menu.
        if (isEditableTarget(e.target)) return
        e.preventDefault()
        e.stopPropagation()
        ctx.select(id)
        ctx.openContextMenu({x: e.clientX, y: e.clientY}, getMenuActions())
      }
    : undefined

  return {isSelected: !!isSelected, onRowClick, onContextMenu}
}

const ROW_CLASS = '-mx-1 rounded-md px-1 py-0.5 transition-colors'
const ROW_SELECTED_CLASS = 'bg-accent/70 ring-border ring-1'

// ---------------------------------------------------------------------------
// Key + row components
// ---------------------------------------------------------------------------

/**
 * Inline-editable object key. Styled like the field label until focused;
 * commits the rename on blur/Enter, reverts on Escape, empty, or collision.
 */
export function EditableFieldKey({
  fieldKey,
  existingKeys,
  onRename,
}: {
  fieldKey: string
  /** Sibling keys (excluding this one) used for collision checks. */
  existingKeys: string[]
  onRename: (newKey: string) => void
}) {
  const [text, setText] = useState(fieldKey)
  useEffect(() => setText(fieldKey), [fieldKey])
  const commit = () => {
    const next = text.trim()
    if (!next || next === fieldKey) {
      setText(fieldKey)
      return
    }
    if (existingKeys.includes(next)) {
      toast.error(`"${next}" already exists`)
      setText(fieldKey)
      return
    }
    if (next === '/') {
      // DAG-JSON reserves the single "/" key for link and bytes forms.
      toast.error('"/" is a reserved field name in DAG-CBOR blobs')
      setText(fieldKey)
      return
    }
    onRename(next)
  }
  return (
    <input
      value={text}
      aria-label={`Field name: ${fieldKey}`}
      className={cn(
        FIELD_LABEL_CLASS,
        'hover:border-border focus:border-border focus:text-foreground w-full border-b border-transparent bg-transparent transition-colors outline-none',
      )}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') setText(fieldKey)
      }}
    />
  )
}

/**
 * All row actions grouped behind one floating trigger, so deep nesting
 * doesn't accumulate button columns or shrink the editors. Mirrors the
 * right-click context menu exactly.
 */
function RowActionsMenu({
  label,
  getActions,
  className,
}: {
  label: string
  getActions: () => ContextMenuAction[]
  className?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="iconSm"
          aria-label={label}
          className={cn(
            'text-muted-foreground bg-background/85 shadow-xs backdrop-blur-[2px]',
            'opacity-0 transition-opacity',
            open && 'opacity-100',
            className,
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        {getActions().map((action) => (
          <DropdownMenuItem
            key={action.key}
            variant={action.destructive ? 'destructive' : 'default'}
            onClick={() => action.onClick()}
          >
            {action.icon}
            {action.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function CollapseToggle({collapsed, onToggle}: {collapsed: boolean; onToggle: () => void}) {
  return (
    <button
      type="button"
      aria-label={collapsed ? 'Expand' : 'Collapse'}
      aria-expanded={!collapsed}
      className="text-muted-foreground hover:text-foreground flex size-4 shrink-0 items-center justify-center"
      onClick={onToggle}
    >
      {collapsed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
    </button>
  )
}

/** Summary line shown in place of a collapsed container's editor. */
function CollapsedSummary({value, onExpand}: {value: unknown; onExpand: () => void}) {
  const summary = Array.isArray(value)
    ? `List · ${value.length} ${value.length === 1 ? 'item' : 'items'}`
    : (() => {
        const count = canonicalEntries(value as Record<string, unknown>).length
        return `Object · ${count} ${count === 1 ? 'field' : 'fields'}`
      })()
  return (
    <button
      type="button"
      className="text-muted-foreground hover:text-foreground w-fit text-sm transition-colors"
      onClick={onExpand}
    >
      {summary}
    </button>
  )
}

/** Shared context-menu actions for a value row. */
function baseMenuActions({
  value,
  handlers,
  isContainer,
  collapsed,
  setCollapsed,
}: {
  value: unknown
  handlers: SelectionHandlers
  isContainer: boolean
  collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
}): ContextMenuAction[] {
  const actions: ContextMenuAction[] = [
    {
      key: 'copy',
      label: 'Copy',
      icon: <Copy className="size-4" />,
      onClick: () => copyValueToClipboard(value),
    },
    {
      key: 'paste',
      label: 'Paste',
      icon: <ClipboardPaste className="size-4" />,
      onClick: () => void pasteFromClipboard(handlers),
    },
  ]
  if (isContainer) {
    actions.push({
      key: 'collapse',
      label: collapsed ? 'Expand' : 'Collapse',
      icon: collapsed ? <ChevronsUpDown className="size-4" /> : <ChevronsDownUp className="size-4" />,
      onClick: () => setCollapsed(!collapsed),
    })
  }
  return actions
}

/**
 * One keyed field row: collapsible for container values, selectable (click),
 * with a right-click menu, rename, copy, and remove. Shared by nested object
 * editors and the top-level metadata field list.
 */
export function FieldRow({
  fieldKey,
  value,
  siblingKeys,
  onValue,
  onRename,
  onRemove,
  rules,
  path,
  className,
}: {
  fieldKey: string
  value: unknown
  /** Sibling keys (excluding this one) used for rename collision checks. */
  siblingKeys: string[]
  onValue: (value: unknown) => void
  onRename: (newKey: string) => void
  onRemove: () => void
  rules: ValueEditorRules
  path: ValuePath
  className?: string
}) {
  const isContainer = isEditableContainer(value)
  const [collapsed, setCollapsed] = useState(false)
  const handlers: SelectionHandlers = {getValue: () => value, setValue: onValue, remove: onRemove, rules}
  const getMenuActions = () => [
    ...baseMenuActions({value, handlers, isContainer, collapsed, setCollapsed}),
    {
      key: 'remove',
      label: `Remove ${fieldKey}`,
      icon: <X className="size-4" />,
      destructive: true,
      onClick: onRemove,
    },
  ]
  const {isSelected, onRowClick, onContextMenu} = useRowSelection(pathId(path), handlers, getMenuActions)
  // A schema-keyed field (key = the schema's ipfs:// URL) labels itself with
  // the schema's title; the raw key stays available in a tooltip.
  const schemaKeyLabel = useSchemaKeyLabel(fieldKey)

  return (
    <div
      onClick={onRowClick}
      onContextMenu={onContextMenu}
      className={cn(
        'group/row relative flex items-start gap-2',
        ROW_CLASS,
        isSelected && ROW_SELECTED_CLASS,
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center gap-1">
          {isContainer ? (
            <CollapseToggle collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
          ) : (
            <span className="size-4 shrink-0" />
          )}
          {schemaKeyLabel ? (
            <Tooltip content={fieldKey}>
              <span className={cn(FIELD_LABEL_CLASS, 'flex items-center gap-1 truncate')}>
                <FileCode2 className="size-3 shrink-0" />
                {schemaKeyLabel}
              </span>
            </Tooltip>
          ) : (
            <EditableFieldKey fieldKey={fieldKey} existingKeys={siblingKeys} onRename={onRename} />
          )}
          <SchemaWarningBadge path={path} />
        </div>
        <div className="pl-5">
          {isContainer && collapsed ? (
            <CollapsedSummary value={value} onExpand={() => setCollapsed(false)} />
          ) : (
            <ValueEditor value={value} onValue={onValue} rules={rules} path={path} />
          )}
        </div>
      </div>
      {/* Floating so nested rows keep their full width. */}
      <div className="absolute top-1 right-0">
        <RowActionsMenu
          label={`Actions for ${fieldKey}`}
          getActions={getMenuActions}
          className={cn('group-focus-within/row:opacity-100 group-hover/row:opacity-100', isSelected && 'opacity-100')}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Display + editors
// ---------------------------------------------------------------------------

/** Read-only recursive rendering of a value. */
export function ValueDisplay({value, rules = CBOR_VALUE_RULES}: {value: unknown; rules?: ValueEditorRules}) {
  if (isDagJsonLink(value)) {
    return (
      <span className="flex items-center gap-1 font-mono text-sm break-all">
        <Link2 className="text-muted-foreground size-3.5 shrink-0" />
        {value['/']}
      </span>
    )
  }
  if (isDagJsonBytes(value)) {
    let size: number | null = null
    try {
      size = base64ToBytes(value['/'].bytes).length
    } catch {
      // fall through to invalid display
    }
    return (
      <span className="font-mono text-sm">
        {size === null ? 'Invalid base64 data' : `${formatByteSize(size)} binary`}
      </span>
    )
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <p className="text-muted-foreground text-sm">Empty list</p>
    return (
      <div className={NESTED_GROUP_CLASS}>
        {value.map((item, index) => (
          <div key={index} className="flex items-baseline gap-2">
            <span className="text-muted-foreground font-mono text-xs">{index + 1}.</span>
            <ValueDisplay value={item} rules={rules} />
          </div>
        ))}
      </div>
    )
  }
  if (isPlainObject(value)) {
    const entries = canonicalEntries(value, {hideNull: rules.hideNullEntries})
    if (entries.length === 0) return <p className="text-muted-foreground text-sm">No fields</p>
    return (
      <div className={NESTED_GROUP_CLASS}>
        {entries.map(([key, child]) => (
          <div key={key} className="flex flex-col gap-1">
            <span className={FIELD_LABEL_CLASS}>{key}</span>
            <ValueDisplay value={child} rules={rules} />
          </div>
        ))}
      </div>
    )
  }
  if (value === '') return <span className="text-muted-foreground text-sm">(empty)</span>
  return <span className="font-mono text-sm break-words whitespace-pre-wrap">{String(value)}</span>
}

/** Recursive type-aware editor for one value. */
export function ValueEditor({
  value,
  onValue,
  rules,
  path = [],
}: {
  value: unknown
  onValue: (value: unknown) => void
  rules: ValueEditorRules
  path?: ValuePath
}) {
  // Advisory schema hint for this node (undefined when editing schemaless).
  const subschema = useSubschema(path)
  const resolvedSchema = subschema && subschema !== 'unresolved' ? subschema : undefined
  // A scalar that is a member of the schema's literal union renders as a
  // dropdown of the options (mixed types supported).
  const allLiteralOptions = resolvedSchema ? literalEnumOptions(resolvedSchema) : null
  const literalOptions =
    allLiteralOptions && allLiteralOptions.some((option) => option.value === value) ? allLiteralOptions : undefined
  if (typeof value === 'boolean') {
    return (
      <ScalarLeafEditor
        value={value}
        literalOptions={literalOptions}
        onValue={onValue}
        renderFallback={() => <Switch checked={value} onCheckedChange={(checked) => onValue(checked)} />}
      />
    )
  }
  if (typeof value === 'number') {
    return (
      <ScalarLeafEditor
        value={value}
        literalOptions={literalOptions}
        onValue={onValue}
        renderFallback={(onFocusChange, autoFocus) => (
          <NumberInput
            value={value}
            onValue={onValue}
            rules={rules}
            autoFocus={autoFocus}
            onFocusChange={onFocusChange}
          />
        )}
      />
    )
  }
  if (typeof value === 'string') {
    const hmMode =
      resolvedSchema?.format === 'hm-profile'
        ? ('profile' as const)
        : resolvedSchema?.format === 'hm-url'
          ? ('document' as const)
          : undefined
    return <StringLeafEditor value={value} literalOptions={literalOptions} hmMode={hmMode} onValue={onValue} />
  }
  if (isDagJsonLink(value)) {
    return <LinkValueEditor value={value} onValue={onValue} />
  }
  if (isDagJsonBytes(value)) {
    return <BytesValueEditor value={value} onValue={onValue} />
  }
  if (Array.isArray(value)) {
    return <ListEditor value={value} onValue={onValue} rules={rules} path={path} />
  }
  if (isPlainObject(value)) {
    return <ObjectEditor value={value} onValue={onValue} rules={rules} path={path} />
  }
  return <span className="text-muted-foreground font-mono text-sm">{String(value)}</span>
}

/**
 * Non-string scalar leaf (number/boolean): the plain editor, or a literal
 * dropdown when the value is a member of the schema's literal union.
 * "Custom value…" temporarily reveals the plain editor (until the next
 * commit), and an actively-focused editor is never unmounted by a
 * late-arriving schema. The union never removes the ability to enter an
 * arbitrary value.
 */
function ScalarLeafEditor({
  value,
  literalOptions,
  onValue,
  renderFallback,
}: {
  value: unknown
  literalOptions: LiteralOption[] | undefined
  onValue: (value: unknown) => void
  renderFallback: (onFocusChange: (focused: boolean) => void, autoFocus: boolean) => React.ReactNode
}) {
  const [editingCustom, setEditingCustom] = useState(false)
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    // A commit landed; a conforming value returns to the select.
    setEditingCustom(false)
  }, [value])
  if (literalOptions && !editingCustom && !focused) {
    return (
      <EnumValueSelect
        value={value}
        options={literalOptions}
        onValue={onValue}
        onEditAsText={() => setEditingCustom(true)}
      />
    )
  }
  return <>{renderFallback(setFocused, editingCustom)}</>
}

/**
 * String leaf: free text, or a select when the value is a member of the
 * schema's literal union. The select never takes over an active edit — a
 * late-arriving schema must not unmount a focused input (blur doesn't fire on
 * unmount, so the draft would be silently lost) — and always offers "Custom
 * value…" back to free text, so the schema never removes the ability to type.
 */
function StringLeafEditor({
  value,
  literalOptions,
  hmMode,
  onValue,
}: {
  value: string
  literalOptions: LiteralOption[] | undefined
  /** Schema format hm-url/hm-profile: search-assisted hypermedia reference input. */
  hmMode?: 'document' | 'profile'
  onValue: (value: unknown) => void
}) {
  const [editingText, setEditingText] = useState(false)
  if (hmMode && !editingText) {
    return <HMEntityField value={value} mode={hmMode} onValue={onValue} />
  }
  if (literalOptions && !editingText) {
    return (
      <EnumValueSelect
        value={value}
        options={literalOptions}
        onValue={onValue}
        onEditAsText={() => setEditingText(true)}
      />
    )
  }
  return (
    <CommitOnBlurInput
      key={value}
      initialValue={value}
      autoFocus={editingText}
      onCommit={(text) => onValue(text)}
      onFocusChange={(focused) => {
        // Focus latches free-text mode; blur (which commits) releases it so a
        // conforming committed value can render as the select again.
        setEditingText(focused)
      }}
    />
  )
}

/** IPLD link (`{"/": cid}`): editable CID with validation and an open action. */
function LinkValueEditor({value, onValue}: {value: {'/': string}; onValue: (value: unknown) => void}) {
  const ctx = useContext(SelectionContext)
  const cid = value['/']
  const isValid = !!parseCidString(cid)
  return (
    <div className="flex items-center gap-1">
      <Tooltip content="IPLD link">
        <Link2 className={cn('size-3.5 shrink-0', isValid ? 'text-muted-foreground' : 'text-destructive')} />
      </Tooltip>
      <CommitOnBlurInput
        key={cid}
        initialValue={cid}
        className="font-mono text-xs"
        onCommit={(text) => {
          const next = text.trim()
          if (!parseCidString(next)) {
            toast.error('Not a valid CID')
            return
          }
          onValue({'/': next})
        }}
      />
      {ctx?.openUrl && isValid && (
        <Tooltip content={`Open ipfs://${cid}`}>
          <Button
            variant="ghost"
            size="iconSm"
            aria-label={`Open ipfs://${cid}`}
            className="text-muted-foreground"
            onClick={() => ctx.openUrl!(`ipfs://${cid}`)}
          >
            <ExternalLink className="size-3.5" />
          </Button>
        </Tooltip>
      )}
    </div>
  )
}

/** IPLD bytes (`{"/": {bytes}}`): size readout with download and replace-from-file. */
function BytesValueEditor({value, onValue}: {value: {'/': {bytes: string}}; onValue: (value: unknown) => void}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const b64 = value['/'].bytes
  const size = useMemo(() => {
    try {
      return base64ToBytes(b64).length
    } catch {
      return null
    }
  }, [b64])

  const download = () => {
    const bytes = base64ToBytes(b64)
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], {type: 'application/octet-stream'}))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'bytes.bin'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className={cn('font-mono text-sm', size === null && 'text-destructive')}>
        {size === null ? 'Invalid base64 data' : `${formatByteSize(size)} binary`}
      </span>
      {size !== null && size > 0 && (
        <Tooltip content="Download binary data">
          <Button
            variant="ghost"
            size="iconSm"
            aria-label="Download binary data"
            className="text-muted-foreground"
            onClick={download}
          >
            <Download className="size-3.5" />
          </Button>
        </Tooltip>
      )}
      <Tooltip content="Replace with file…">
        <Button
          variant="ghost"
          size="iconSm"
          aria-label="Replace with file"
          className="text-muted-foreground"
          onClick={() => fileInputRef.current?.click()}
        >
          <FileUp className="size-3.5" />
        </Button>
      </Tooltip>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          file
            .arrayBuffer()
            .then((buffer) => onValue({'/': {bytes: bytesToBase64(new Uint8Array(buffer))}}))
            .catch(() => toast.error('Failed to read file'))
        }}
      />
    </div>
  )
}

/**
 * Recursive object editor: one row per visible key. Removal follows
 * `rules.removeKeys`; changes bubble up by rebuilding this object.
 */
export function ObjectEditor({
  value,
  onValue,
  rules,
  path = [],
}: {
  value: Record<string, unknown>
  onValue: (value: unknown) => void
  rules: ValueEditorRules
  path?: ValuePath
}) {
  const entries = canonicalEntries(value, {hideNull: rules.hideNullEntries})
  const removeKey = (key: string) => {
    if (rules.removeKeys === 'tombstone') {
      onValue({...value, [key]: null})
    } else {
      const next = {...value}
      delete next[key]
      onValue(next)
    }
  }
  const renameKey = (key: string, newKey: string) => {
    if (rules.removeKeys === 'tombstone') {
      onValue({...value, [key]: null, [newKey]: value[key]})
    } else {
      const next = {...value}
      delete next[key]
      next[newKey] = value[key]
      onValue(next)
    }
  }
  return (
    <div className={NESTED_GROUP_CLASS}>
      {entries.length === 0 && <p className="text-muted-foreground text-sm">No fields</p>}
      {entries.map(([key, child]) => (
        <FieldRow
          key={key}
          fieldKey={key}
          value={child}
          siblingKeys={entries.map(([k]) => k).filter((k) => k !== key)}
          onValue={(newChild) => onValue({...value, [key]: newChild})}
          onRename={(newKey) => renameKey(key, newKey)}
          onRemove={() => removeKey(key)}
          rules={rules}
          path={[...path, key]}
        />
      ))}
      <SchemaFieldChips
        path={path}
        existingKeys={Object.keys(value)}
        rules={rules}
        onAdd={(key, newChild) => onValue({...value, [key]: newChild})}
      />
      <AddFieldForm
        compact
        rules={rules}
        path={path}
        existingKeys={entries.map(([key]) => key)}
        onAdd={(key, newChild) => onValue({...value, [key]: newChild})}
      />
    </div>
  )
}

/** Recursive list editor: edit, collapse, select, drag to reorder, remove, and append items. */
export function ListEditor({
  value,
  onValue,
  rules,
  path = [],
}: {
  value: unknown[]
  onValue: (value: unknown) => void
  rules: ValueEditorRules
  path?: ValuePath
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  const move = (from: number, to: number) => {
    if (from === to) return
    const next = [...value]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    onValue(next)
  }
  const endDrag = () => {
    setDragIndex(null)
    setOverIndex(null)
  }
  return (
    <div className={NESTED_GROUP_CLASS}>
      {value.length === 0 && <p className="text-muted-foreground text-sm">Empty list</p>}
      {value.map((item, index) => (
        <ListItemRow
          key={index}
          item={item}
          index={index}
          count={value.length}
          onItem={(newItem) => onValue(value.map((v, i) => (i === index ? newItem : v)))}
          onMove={move}
          onDuplicate={() => {
            const next = [...value]
            next.splice(index + 1, 0, structuredClone(item))
            onValue(next)
          }}
          onRemove={() => onValue(value.filter((_, i) => i !== index))}
          rules={rules}
          path={[...path, index]}
          drag={{
            isDragging: dragIndex === index,
            isDragOver: dragIndex !== null && dragIndex !== index && overIndex === index,
            onDragStart: () => setDragIndex(index),
            onDragOver: () => setOverIndex(index),
            onDrop: () => {
              if (dragIndex !== null) move(dragIndex, index)
              endDrag()
            },
            onDragEnd: endDrag,
            active: dragIndex !== null,
          }}
        />
      ))}
      <AddFieldForm compact itemMode rules={rules} path={path} onAdd={(_key, item) => onValue([...value, item])} />
    </div>
  )
}

type ListItemDrag = {
  isDragging: boolean
  isDragOver: boolean
  active: boolean
  onDragStart: () => void
  onDragOver: () => void
  onDrop: () => void
  onDragEnd: () => void
}

function ListItemRow({
  item,
  index,
  count,
  onItem,
  onMove,
  onDuplicate,
  onRemove,
  rules,
  path,
  drag,
}: {
  item: unknown
  index: number
  count: number
  onItem: (item: unknown) => void
  onMove: (from: number, to: number) => void
  onDuplicate: () => void
  onRemove: () => void
  rules: ValueEditorRules
  path: ValuePath
  drag: ListItemDrag
}) {
  const isContainer = isEditableContainer(item)
  const [collapsed, setCollapsed] = useState(false)
  const handlers: SelectionHandlers = {getValue: () => item, setValue: onItem, remove: onRemove, rules}
  const getMenuActions = () => [
    ...baseMenuActions({value: item, handlers, isContainer, collapsed, setCollapsed}),
    {
      key: 'duplicate',
      label: 'Duplicate',
      icon: <CopyPlus className="size-4" />,
      onClick: onDuplicate,
    },
    ...(index > 0
      ? [
          {
            key: 'move-up',
            label: 'Move up',
            icon: <ArrowUp className="size-4" />,
            onClick: () => onMove(index, index - 1),
          },
        ]
      : []),
    ...(index < count - 1
      ? [
          {
            key: 'move-down',
            label: 'Move down',
            icon: <ArrowDown className="size-4" />,
            onClick: () => onMove(index, index + 1),
          },
        ]
      : []),
    {
      key: 'remove',
      label: 'Remove item',
      icon: <X className="size-4" />,
      destructive: true,
      onClick: onRemove,
    },
  ]
  const {isSelected, onRowClick, onContextMenu} = useRowSelection(pathId(path), handlers, getMenuActions)

  return (
    <div
      onClick={onRowClick}
      onContextMenu={onContextMenu}
      onDragOver={(e) => {
        if (!drag.active) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        drag.onDragOver()
      }}
      onDrop={(e) => {
        if (!drag.active) return
        e.preventDefault()
        drag.onDrop()
      }}
      className={cn(
        'group/item relative flex items-start gap-2',
        ROW_CLASS,
        isSelected && ROW_SELECTED_CLASS,
        drag.isDragging && 'opacity-40',
        drag.isDragOver && 'ring-primary/50 bg-accent/40 ring-2',
      )}
    >
      <div className="mt-1.5 flex shrink-0 items-center gap-1">
        <span
          draggable
          aria-label="Drag to reorder"
          className={cn(
            'text-muted-foreground -ml-1 flex cursor-grab items-center opacity-0 transition-opacity active:cursor-grabbing',
            'group-focus-within/item:opacity-100 group-hover/item:opacity-100',
            (isSelected || drag.active) && 'opacity-100',
          )}
          onDragStart={(e) => {
            e.dataTransfer.effectAllowed = 'move'
            e.dataTransfer.setData('text/plain', JSON.stringify(toCanonicalOrder(item), null, 2))
            drag.onDragStart()
          }}
          onDragEnd={drag.onDragEnd}
        >
          <GripVertical className="size-3.5" />
        </span>
        {isContainer ? (
          <CollapseToggle collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
        ) : (
          <span className="size-4 shrink-0" />
        )}
        <span className="text-muted-foreground font-mono text-xs">{index + 1}.</span>
        <SchemaWarningBadge path={path} />
      </div>
      <div className="min-w-0 flex-1">
        {isContainer && collapsed ? (
          <div className="pt-1">
            <CollapsedSummary value={item} onExpand={() => setCollapsed(false)} />
          </div>
        ) : (
          <ValueEditor value={item} onValue={onItem} rules={rules} path={path} />
        )}
      </div>
      {/* Floating so nested rows keep their full width. */}
      <div className="absolute top-1 right-0">
        <RowActionsMenu
          label={`Actions for item ${index + 1}`}
          getActions={getMenuActions}
          className={cn(
            'group-focus-within/item:opacity-100 group-hover/item:opacity-100',
            isSelected && 'opacity-100',
          )}
        />
      </div>
    </div>
  )
}

/** Number input that stages on blur/Enter, validates per rules, resets on Escape. */
function NumberInput({
  value,
  onValue,
  rules,
  autoFocus,
  onFocusChange,
}: {
  value: number
  onValue: (value: unknown) => void
  rules: ValueEditorRules
  autoFocus?: boolean
  onFocusChange?: (focused: boolean) => void
}) {
  const initial = String(value)
  const [text, setText] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setText(initial)
    setError(null)
  }, [initial])
  return (
    <div className="flex flex-col gap-1">
      <Input
        value={text}
        inputMode="numeric"
        autoFocus={autoFocus}
        onFocus={() => onFocusChange?.(true)}
        onChange={(e) => {
          setText(e.target.value)
          setError(null)
        }}
        onBlur={() => {
          onFocusChange?.(false)
          if (text === initial) return
          const parsed = Number(text)
          const valid = text.trim() !== '' && (rules.floats ? Number.isFinite(parsed) : Number.isInteger(parsed))
          if (!valid) {
            setError(rules.floats ? 'Enter a number' : 'Enter a whole number')
            return
          }
          onValue(parsed)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') setText(initial)
        }}
      />
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  )
}

/** Text input that stages its value on blur or Enter, resets on Escape. */
function CommitOnBlurInput({
  initialValue,
  placeholder,
  className,
  autoFocus,
  onCommit,
  onFocusChange,
}: {
  initialValue: string
  placeholder?: string
  className?: string
  autoFocus?: boolean
  onCommit: (text: string) => void
  onFocusChange?: (focused: boolean) => void
}) {
  const [text, setText] = useState(initialValue)
  return (
    <Input
      value={text}
      placeholder={placeholder}
      className={className}
      autoFocus={autoFocus}
      onFocus={() => onFocusChange?.(true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text !== initialValue) onCommit(text)
        onFocusChange?.(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') setText(initialValue)
      }}
    />
  )
}

type NewFieldType = 'text' | 'number' | 'toggle' | 'object' | 'list' | 'null' | 'link' | 'bytes' | 'json'

/**
 * Collapsed "+ Add field" affordance that expands into an inline form.
 * `itemMode` drops the key input for appending list items. Object and List
 * create empty containers that are then edited in place. The JSON type is the
 * explicit escape hatch for pasting a subtree.
 */
export function AddFieldForm({
  existingKeys = [],
  itemMode = false,
  compact = false,
  rules,
  path,
  onKeyTextChange,
  onAdd,
}: {
  existingKeys?: string[]
  itemMode?: boolean
  compact?: boolean
  rules: ValueEditorRules
  /** Path of the container being added to; enables schema suggestions. */
  path?: ValuePath
  /** Reports the field-name text as it's typed (e.g. to prefetch schema-URL keys). */
  onKeyTextChange?: (keyText: string) => void
  onAdd: (key: string, value: unknown) => void
}) {
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState('')
  const [type, setType] = useState<NewFieldType>('text')
  const [textValue, setTextValue] = useState('')
  const [toggleValue, setToggleValue] = useState(true)
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Schema hints: declared-but-absent keys for objects, the items schema for
  // lists. Both are empty/undefined when no schema is attached.
  const keySuggestions = useSchemaFieldSuggestions(path ?? [], existingKeys)
  const itemsSubschema = useSubschema(path ? [...path, 0] : [])
  const suggestions = itemMode || !path ? [] : keySuggestions

  // When the field being added declares a literal union, the value input is a
  // dropdown of the (possibly mixed-type) options; the commit maps the chosen
  // label back to the typed literal.
  const enumSourceSchema = itemMode
    ? itemsSubschema && itemsSubschema !== 'unresolved'
      ? itemsSubschema
      : undefined
    : suggestions.find((suggestion) => suggestion.key === key.trim())?.schema
  const enumOptions: LiteralOption[] | undefined =
    type === 'text' && enumSourceSchema ? literalEnumOptions(enumSourceSchema) ?? undefined : undefined

  // Typing a key the schema declares (including a just-fetched schema-URL
  // key) immediately adopts that field's type, so e.g. a literal union shows
  // its dropdown without any extra step.
  const matchedSuggestionType = suggestions.find((suggestion) => suggestion.key === key.trim())?.type ?? null
  useEffect(() => {
    if (
      matchedSuggestionType &&
      (matchedSuggestionType !== 'list' || rules.lists) &&
      ((matchedSuggestionType !== 'link' && matchedSuggestionType !== 'bytes') || rules.ipld)
    ) {
      setType(matchedSuggestionType)
    }
  }, [matchedSuggestionType])

  const reset = () => {
    setOpen(false)
    setKey('')
    setType('text')
    setTextValue('')
    setToggleValue(true)
    setFile(null)
    setError(null)
    onKeyTextChange?.('')
  }

  if (!open) {
    return (
      <div>
        <Button
          variant="ghost"
          size="sm"
          className={cn('text-muted-foreground', compact && 'h-6 px-1 text-xs')}
          onClick={() => {
            setOpen(true)
            // Pre-select the type a list's items schema calls for.
            if (itemMode && itemsSubschema && itemsSubschema !== 'unresolved') {
              const suggested = suggestedFieldType(itemsSubschema)
              if (
                suggested &&
                (suggested !== 'list' || rules.lists) &&
                ((suggested !== 'link' && suggested !== 'bytes') || rules.ipld)
              ) {
                setType(suggested)
              }
            }
          }}
        >
          <Plus className={compact ? 'size-3' : 'size-4'} />
          {itemMode ? 'Add item' : 'Add field'}
        </Button>
      </div>
    )
  }

  const submit = () => {
    const trimmedKey = key.trim()
    if (!itemMode) {
      if (!trimmedKey) {
        setError('Enter a field name')
        return
      }
      if (existingKeys.includes(trimmedKey)) {
        setError(`"${trimmedKey}" already exists — edit it above`)
        return
      }
      if (trimmedKey === '/') {
        // DAG-JSON reserves the single "/" key for link and bytes forms.
        setError('"/" is a reserved field name in DAG-CBOR blobs')
        return
      }
    }
    let value: unknown
    if (type === 'text') {
      if (enumOptions) {
        // textValue holds the selected LABEL; commit the typed literal (the
        // select's display fallback is the first option).
        const chosen = enumOptions.find((option) => option.label === textValue) ?? enumOptions[0]
        value = chosen ? chosen.value : ''
      } else {
        value = textValue
      }
    } else if (type === 'toggle') value = toggleValue
    else if (type === 'object') value = {}
    else if (type === 'list') value = []
    else if (type === 'null') value = null
    else if (type === 'link') {
      const cidText = textValue.trim().replace(/^ipfs:\/\//, '')
      if (!parseCidString(cidText)) {
        setError('Enter a valid CID (or ipfs:// URL)')
        return
      }
      value = {'/': cidText}
    } else if (type === 'bytes') {
      if (!file) {
        setError('Choose a file')
        return
      }
      file
        .arrayBuffer()
        .then((buffer) => {
          onAdd(trimmedKey, {'/': {bytes: bytesToBase64(new Uint8Array(buffer))}})
          reset()
        })
        .catch(() => setError('Failed to read file'))
      return
    } else if (type === 'number') {
      const parsed = Number(textValue)
      const valid = textValue.trim() !== '' && (rules.floats ? Number.isFinite(parsed) : Number.isInteger(parsed))
      if (!valid) {
        setError(rules.floats ? 'Enter a number' : 'Enter a whole number')
        return
      }
      value = parsed
    } else {
      try {
        value = JSON.parse(textValue)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Invalid JSON')
        return
      }
      const problem = findInvalidValue(value, rules, [trimmedKey || 'item'])
      if (problem) {
        setError(problem)
        return
      }
    }
    onAdd(trimmedKey, value)
    reset()
  }

  const needsValueInput = type === 'text' || type === 'number' || type === 'link'

  return (
    <div className="border-border flex flex-col gap-2 rounded-md border border-dashed p-3">
      {suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-muted-foreground text-xs">Schema fields:</span>
          {suggestions.map((suggestion) => (
            <Button
              key={suggestion.key}
              variant="outline"
              size="sm"
              className="h-6 px-2 font-mono text-xs"
              onClick={() => {
                setKey(suggestion.key)
                setError(null)
                const suggested = suggestion.type
                if (
                  suggested &&
                  (suggested !== 'list' || rules.lists) &&
                  ((suggested !== 'link' && suggested !== 'bytes') || rules.ipld)
                ) {
                  setType(suggested)
                }
                // Prefill from the schema so a literal-union field lands as
                // a member (and immediately renders as its dropdown).
                if (suggested === 'text') {
                  const {schema} = suggestion
                  const options = literalEnumOptions(schema)
                  const prefill = options
                    ? (options.find((option) => option.value === schema.default) ?? options[0])!.label
                    : typeof schema.default === 'string'
                      ? schema.default
                      : ''
                  setTextValue(prefill)
                } else if (suggested === 'number') {
                  const {schema} = suggestion
                  setTextValue(typeof schema.default === 'number' ? String(schema.default) : '')
                }
              }}
            >
              {suggestion.key}
              {suggestion.required ? ' *' : ''}
            </Button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {!itemMode && (
          <Input
            value={key}
            placeholder="Field name"
            className="w-44"
            autoFocus
            onChange={(e) => {
              setKey(e.target.value)
              setError(null)
              onKeyTextChange?.(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              if (e.key === 'Escape') reset()
            }}
          />
        )}
        <Select value={type} onValueChange={(v) => setType(v as NewFieldType)}>
          <SelectTrigger className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="text">Text</SelectItem>
            <SelectItem value="number">Number</SelectItem>
            <SelectItem value="toggle">Toggle</SelectItem>
            <SelectItem value="object">Object</SelectItem>
            {rules.lists && <SelectItem value="list">List</SelectItem>}
            {!rules.hideNullEntries && <SelectItem value="null">Null</SelectItem>}
            {rules.ipld && <SelectItem value="link">Link</SelectItem>}
            {rules.ipld && <SelectItem value="bytes">Bytes</SelectItem>}
            <SelectItem value="json">JSON</SelectItem>
          </SelectContent>
        </Select>
        {type === 'toggle' && <Switch checked={toggleValue} onCheckedChange={setToggleValue} />}
        {type === 'bytes' && (
          <label className="border-input hover:bg-accent flex h-9 min-w-40 flex-1 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm">
            <FileUp className="text-muted-foreground size-4 shrink-0" />
            <span className={cn('truncate', !file && 'text-muted-foreground')}>
              {file ? file.name : 'Choose a file…'}
            </span>
            <input
              type="file"
              className="hidden"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null)
                setError(null)
              }}
            />
          </label>
        )}
        {needsValueInput &&
          (enumOptions ? (
            <Select
              value={enumOptions.some((option) => option.label === textValue) ? textValue : enumOptions[0]?.label ?? ''}
              onValueChange={(next) => {
                setTextValue(next)
                setError(null)
              }}
            >
              <SelectTrigger className="w-fit min-w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {enumOptions.map((option) => (
                  <SelectItem key={option.label} value={option.label}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <Input
              value={textValue}
              placeholder={type === 'link' ? 'CID or ipfs:// URL' : 'Value'}
              inputMode={type === 'number' ? 'numeric' : undefined}
              className={cn('min-w-40 flex-1', type === 'link' && 'font-mono text-xs')}
              autoFocus={itemMode}
              onChange={(e) => {
                setTextValue(e.target.value)
                setError(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit()
                if (e.key === 'Escape') reset()
              }}
            />
          ))}
        <Button size="sm" onClick={submit}>
          <Check className="size-4" />
          Add
        </Button>
        <Button variant="ghost" size="sm" onClick={reset}>
          Cancel
        </Button>
      </div>
      {type === 'json' && (
        <Textarea
          value={textValue}
          placeholder='{"example": true}'
          rows={4}
          className="font-mono text-sm"
          onChange={(e) => {
            setTextValue(e.target.value)
            setError(null)
          }}
        />
      )}
      {error && <p className="text-destructive text-xs">{error}</p>}
    </div>
  )
}
