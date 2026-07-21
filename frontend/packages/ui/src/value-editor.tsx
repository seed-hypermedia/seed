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
  FilePlus,
  FileText,
  FileUp,
  GripVertical,
  Link2,
  MoreHorizontal,
  Pencil,
  Plus,
  X,
} from 'lucide-react'
import {useDebounce} from '@shm/shared/utils/use-debounce'
import {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react'
import {Button} from './button'
import {Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle} from './components/dialog'
import {DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger} from './components/dropdown-menu'
import {Input} from './components/input'
import {Switch} from './components/switch'
import {base64ToBytes, bytesToBase64, formatByteSize, isDagJsonBytes, isDagJsonLink, parseCidString} from './dag-json'
import {findIpfsUrlCid, gatewayUrlToIpfs} from './get-file-url'
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from './select-dropdown'
import {Spinner} from './spinner'
import {toast} from './toast'
import {Tooltip} from './tooltip'
import {cn} from './utils'
import {seedValue} from './onyx/onyx-data-editor'
import {onyxSubschema, useOnyxSchema, useSubschema} from './onyx/onyx-schema-context'
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
} from './onyx/onyx-value-editor-schema'

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

/** Everything the tree needs to know about a rendered row, for navigation + focus. */
type RowInfo = {
  path: ValuePath
  handlers: SelectionHandlers
  isContainer: boolean
  collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
  getMenuActions: () => ContextMenuAction[]
}

type NavDirection = 'up' | 'down' | 'left' | 'right' | 'home' | 'end'

/**
 * Stable tree actions (referentially constant across renders, so row `ref`
 * callbacks don't churn and element registration stays reliable).
 */
type SelectionActions = {
  register: (id: string, info: RowInfo) => void
  unregister: (id: string) => void
  setElement: (id: string, element: HTMLElement | null) => void
  /** Select a row (highlight + make it the tab-stop) without moving DOM focus. */
  select: (id: string) => void
  /** Select a row and move DOM focus to it. */
  focusRow: (id: string) => void
  clear: () => void
  /** Arrow-key navigation from a row. */
  navigate: (id: string, direction: NavDirection) => void
  /** Enter/Space on a row: toggle a container, else focus its first editor. */
  activate: (id: string) => void
  openContextMenu: (position: {x: number; y: number}, actions: ContextMenuAction[]) => void
}

/** Reactive tree state; changes here re-render rows (highlight, roving tab-stop). */
type SelectionState = {
  selectedId: string | null
  /** The single tab-stop for the whole tree (roving tabindex / one focus group). */
  tabbableId: string | null
  /** Opens ipfs://... URLs from link values, when the host page provides navigation. */
  openUrl?: (url: string) => void
  /** Uploads a dropped/picked file to IPFS, returning its bare CID. */
  fileUpload?: (file: File) => Promise<string>
  /** Opens an uploaded IPFS file (by CID) in its own dedicated viewer window. */
  openFile?: (cid: string) => void
  /** Opens a blank blob editor (a new IPFS object) in its own window. */
  onCreateBlob?: () => void
}

const SelectionActionsContext = createContext<SelectionActions | null>(null)
const SelectionStateContext = createContext<SelectionState>({selectedId: null, tabbableId: null})

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest('input,textarea,select,[contenteditable="true"]')
}

/** Registered rows in current DOM order (skips unmounted/collapsed-away rows). */
function domOrderedRows(
  registry: Map<string, RowInfo>,
  elements: Map<string, HTMLElement>,
): {id: string; info: RowInfo; element: HTMLElement}[] {
  const rows: {id: string; info: RowInfo; element: HTMLElement}[] = []
  registry.forEach((info, id) => {
    const element = elements.get(id)
    if (element?.isConnected) rows.push({id, info, element})
  })
  rows.sort((a, b) => (a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
  return rows
}

/** True when `child` is a strictly-deeper path under `parent`. */
function isDescendantPath(child: ValuePath, parent: ValuePath): boolean {
  return child.length > parent.length && parent.every((seg, i) => child[i] === seg)
}

/** Parse and validate clipboard-ish text for pasting. Non-JSON pastes as a string. */
function parsePastedText(text: string, rules: ValueEditorRules): {value: unknown} | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    parsed = text
  }
  // A pasted gateway URL (https://…/ipfs/<cid>) becomes an ipfs:// reference,
  // matching the text-input paste behavior (this path fires when a row — not
  // the input — is selected).
  if (typeof parsed === 'string') {
    parsed = gatewayUrlToIpfs(parsed) ?? parsed
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
  fileUpload,
  openFile,
  onCreateBlob,
}: {
  children: React.ReactNode
  onUndo?: () => void
  onRedo?: () => void
  openUrl?: (url: string) => void
  fileUpload?: (file: File) => Promise<string>
  openFile?: (cid: string) => void
  onCreateBlob?: () => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // The single tab-stop; defaults to the first row so Tab can enter the tree.
  const [tabbableId, setTabbableId] = useState<string | null>(null)
  const [menu, setMenu] = useState<{x: number; y: number; actions: ContextMenuAction[]} | null>(null)
  const registry = useRef(new Map<string, RowInfo>())
  const elements = useRef(new Map<string, HTMLElement>())

  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId
  const undoRef = useRef(onUndo)
  undoRef.current = onUndo
  const redoRef = useRef(onRedo)
  redoRef.current = onRedo

  const select = useCallback((id: string) => {
    setSelectedId(id)
    setTabbableId(id)
  }, [])
  const focusRow = useCallback(
    (id: string) => {
      select(id)
      elements.current.get(id)?.focus()
    },
    [select],
  )
  const navigate = useCallback(
    (id: string, direction: NavDirection) => {
      const rows = domOrderedRows(registry.current, elements.current)
      const idx = rows.findIndex((r) => r.id === id)
      if (idx < 0) return
      const {info} = rows[idx]!
      const go = (target?: {id: string}) => {
        if (target) focusRow(target.id)
      }
      switch (direction) {
        case 'down':
          go(rows[idx + 1])
          break
        case 'up':
          go(rows[idx - 1])
          break
        case 'home':
          go(rows[0])
          break
        case 'end':
          go(rows[rows.length - 1])
          break
        case 'right':
          if (info.isContainer && info.collapsed) info.setCollapsed(false)
          else if (info.isContainer) {
            const next = rows[idx + 1]
            if (next && isDescendantPath(next.info.path, info.path)) go(next)
          }
          break
        case 'left':
          if (info.isContainer && !info.collapsed) info.setCollapsed(true)
          else go(rows.find((r) => r.id === pathId(info.path.slice(0, -1))))
          break
      }
    },
    [focusRow],
  )
  const activate = useCallback((id: string) => {
    const info = registry.current.get(id)
    if (!info) return
    if (info.isContainer) {
      info.setCollapsed(!info.collapsed)
      return
    }
    // Leaf: focus its first editable control so typing edits the value.
    elements.current.get(id)?.querySelector<HTMLElement>('input, textarea, [role="combobox"]')?.focus()
  }, [])

  // Stable actions object (identity never changes) — so row ref callbacks and
  // effects don't churn as selection state changes.
  const actions = useRef<SelectionActions>({
    select,
    focusRow,
    clear: () => setSelectedId(null),
    navigate,
    activate,
    register: (id, info) => {
      registry.current.set(id, info)
      // The first row to register becomes the tree's tab-stop.
      setTabbableId((cur) => cur ?? id)
    },
    unregister: (id) => {
      // NB: the effect that calls this re-runs every render, so its cleanup
      // fires on re-renders too — only touch the registry here. The `elements`
      // map is owned by the row's ref callback, which clears it on real unmount.
      registry.current.delete(id)
      setTabbableId((cur) => (cur === id ? registry.current.keys().next().value ?? null : cur))
    },
    setElement: (id, element) => {
      if (element) elements.current.set(id, element)
      else elements.current.delete(id)
    },
    openContextMenu: (position, menuActions) => setMenu({...position, actions: menuActions}),
  }).current
  const state = useMemo<SelectionState>(
    () => ({selectedId, tabbableId, openUrl, fileUpload, openFile, onCreateBlob}),
    [selectedId, tabbableId, openUrl, fileUpload, openFile, onCreateBlob],
  )

  useEffect(() => {
    const getSelectedHandlers = () => {
      const id = selectedIdRef.current
      return id ? registry.current.get(id)?.handlers : undefined
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
    <SelectionActionsContext.Provider value={actions}>
      <SelectionStateContext.Provider value={state}>
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
      </SelectionStateContext.Provider>
    </SelectionActionsContext.Provider>
  )
}

const ARROW_DIRECTIONS: Record<string, NavDirection> = {
  ArrowDown: 'down',
  ArrowUp: 'up',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Home: 'home',
  End: 'end',
}

/**
 * Row-level wiring: registers the row for tree navigation and returns props to
 * spread on the row element (roving tabindex, focus, arrow keys, context menu).
 */
function useRowSelection(
  id: string,
  row: {
    path: ValuePath
    handlers: SelectionHandlers
    isContainer: boolean
    collapsed: boolean
    setCollapsed: (collapsed: boolean) => void
    getMenuActions: () => ContextMenuAction[]
  },
) {
  const actions = useContext(SelectionActionsContext)
  const {selectedId, tabbableId} = useContext(SelectionStateContext)
  const isSelected = selectedId === id
  const isTabbable = tabbableId === id

  // Keep the registry fresh with the latest value/handlers/collapse on every render.
  useEffect(() => {
    if (!actions) return
    actions.register(id, {
      path: row.path,
      handlers: row.handlers,
      isContainer: row.isContainer,
      collapsed: row.collapsed,
      setCollapsed: row.setCollapsed,
      getMenuActions: row.getMenuActions,
    })
    return () => actions.unregister(id)
  })

  // `actions` is referentially stable, so this ref callback never churns.
  const setRef = useCallback(
    (element: HTMLElement | null) => {
      actions?.setElement(id, element)
    },
    [actions, id],
  )

  if (!actions) {
    return {isSelected: false, rowProps: {} as Record<string, never>}
  }
  const ctx = actions

  const rowProps = {
    ref: setRef,
    role: 'treeitem' as const,
    tabIndex: isTabbable ? 0 : -1,
    'aria-selected': isSelected,
    ...(row.isContainer ? {'aria-expanded': !row.collapsed} : {}),
    onFocus: (e: React.FocusEvent) => {
      // Selection follows focus — whether the row itself or any editor inside
      // it is focused (so tabbing between fields moves the highlight too). The
      // innermost row wins, so focusing a nested object's field selects it, not
      // its ancestors.
      if ((e.target as HTMLElement).closest('[role="treeitem"]') === e.currentTarget) ctx.select(id)
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      // Let inner editors handle their own keys (text nav, etc.).
      if (e.target !== e.currentTarget) return
      const direction = ARROW_DIRECTIONS[e.key]
      if (direction) {
        e.preventDefault()
        ctx.navigate(id, direction)
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        ctx.activate(id)
      }
    },
    onClick: (e: React.MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('input,textarea,button,select,a,[contenteditable="true"],[role="combobox"]')) return
      e.stopPropagation()
      ctx.focusRow(id)
    },
    onContextMenu: (e: React.MouseEvent) => {
      // Right-click inside inputs keeps the native text menu.
      if (isEditableTarget(e.target)) return
      e.preventDefault()
      e.stopPropagation()
      ctx.focusRow(id)
      ctx.openContextMenu({x: e.clientX, y: e.clientY}, row.getMenuActions())
    },
  }

  return {isSelected: !!isSelected, rowProps}
}

const ROW_CLASS = '-mx-1 rounded-md px-1 py-0.5 transition-colors'
const ROW_SELECTED_CLASS = 'bg-accent/70 ring-border ring-1'

// ---------------------------------------------------------------------------
// Row components
// ---------------------------------------------------------------------------

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
 * with a right-click menu, copy, and remove. The field's NAME and TYPE are
 * locked once created — they change only through the "Edit field" dialog
 * (which fires `onEditField` with the new key and the coerced value). Shared
 * by nested object editors and the top-level metadata field list.
 */
export function FieldRow({
  fieldKey,
  value,
  siblingKeys,
  onValue,
  onEditField,
  onRemove,
  rules,
  path,
  className,
  canRemove = true,
}: {
  fieldKey: string
  value: unknown
  /** Sibling keys (excluding this one) used for rename collision checks. */
  siblingKeys: string[]
  onValue: (value: unknown) => void
  /**
   * Rename and/or retype the field: receives the new key and the new value
   * (already coerced to the chosen type). `newKey` may equal `fieldKey`.
   */
  onEditField: (newKey: string, newValue: unknown) => void
  onRemove: () => void
  rules: ValueEditorRules
  path: ValuePath
  className?: string
  /**
   * Whether the field may be removed. `false` (e.g. a schema-required field)
   * hides the Remove action and disables the selection/keyboard delete.
   */
  canRemove?: boolean
}) {
  const isContainer = isEditableContainer(value)
  const [collapsed, setCollapsed] = useState(false)
  const [editing, setEditing] = useState(false)
  const onCreateBlob = useContext(SelectionStateContext).onCreateBlob
  // A non-removable field ignores the selection/keyboard delete path too.
  const handlers: SelectionHandlers = {
    getValue: () => value,
    setValue: onValue,
    remove: canRemove ? onRemove : () => {},
    rules,
  }
  // A schema-keyed field (key = the schema's ipfs:// URL) labels itself with
  // the schema's title; the raw key stays available in a tooltip.
  const schemaKeyLabel = useSchemaKeyLabel(fieldKey)
  // Schema-keyed fields are structural — their name/type are dictated by the
  // attached schema, so the name/type edit dialog doesn't apply to them.
  const canEditField = !schemaKeyLabel
  const getMenuActions = () => [
    ...baseMenuActions({value, handlers, isContainer, collapsed, setCollapsed}),
    // Text fields can spawn a new IPFS object (blob) to reference here.
    ...(typeof value === 'string' && onCreateBlob
      ? [
          {
            key: 'new-blob',
            label: 'New blob…',
            icon: <FilePlus className="size-4" />,
            onClick: onCreateBlob,
          },
        ]
      : []),
    ...(canEditField
      ? [
          {
            key: 'edit',
            label: 'Edit field',
            icon: <Pencil className="size-4" />,
            onClick: () => setEditing(true),
          },
        ]
      : []),
    ...(canRemove
      ? [
          {
            key: 'remove',
            label: `Remove ${fieldKey}`,
            icon: <X className="size-4" />,
            destructive: true,
            onClick: onRemove,
          },
        ]
      : []),
  ]
  const {isSelected, rowProps} = useRowSelection(pathId(path), {
    path,
    handlers,
    isContainer,
    collapsed,
    setCollapsed,
    getMenuActions,
  })

  return (
    <div
      {...rowProps}
      className={cn(
        'group/row relative flex items-start gap-2 outline-none',
        ROW_CLASS,
        isSelected && ROW_SELECTED_CLASS,
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {/* Field name first (so the row's first span is the label and names
            align regardless of type); the collapse chevron sits after it. */}
        <div className="flex items-center gap-1">
          {schemaKeyLabel ? (
            <Tooltip content={fieldKey}>
              <span className={cn(FIELD_LABEL_CLASS, 'flex items-center gap-1 truncate')}>
                <FileCode2 className="size-3 shrink-0" />
                {schemaKeyLabel}
              </span>
            </Tooltip>
          ) : (
            <span className={cn(FIELD_LABEL_CLASS, 'truncate')} title={fieldKey}>
              {fieldKey}
            </span>
          )}
          {isContainer && <CollapseToggle collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />}
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
          // Only the selected row shows its actions (selection follows focus),
          // so nested objects don't light up every ancestor's menu at once.
          className={cn(isSelected && 'opacity-100')}
        />
      </div>
      {canEditField && (
        <FieldDialog
          open={editing}
          onOpenChange={setEditing}
          mode="edit"
          rules={rules}
          path={path.slice(0, -1)}
          existingKeys={siblingKeys}
          initialName={fieldKey}
          initialType={valueToFieldType(value)}
          onSubmit={(newKey, newType) => {
            const newValue = newType === valueToFieldType(value) ? value : coerceFieldValue(value, newType, rules)
            onEditField(newKey, newValue)
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Display + editors
// ---------------------------------------------------------------------------

/** Read-only recursive rendering of a value. */
export function ValueDisplay({value, rules = CBOR_VALUE_RULES}: {value: unknown; rules?: ValueEditorRules}) {
  const sel = useContext(SelectionStateContext)
  const openFile = sel?.openFile
  const openUrl = sel?.openUrl
  if (typeof value === 'string') {
    const cid = findIpfsUrlCid(value)
    if (cid) return <IpfsFileTag cid={cid} onOpen={openFile} />
    if (value.startsWith('hm://') && openUrl) {
      return (
        <button
          type="button"
          className="text-primary font-mono text-sm break-all hover:underline"
          onClick={() => openUrl(value)}
        >
          {value}
        </button>
      )
    }
  }
  // A native IPLD link renders as the same tag as an ipfs:// reference.
  if (isDagJsonLink(value) && parseCidString(value['/'])) {
    return <IpfsFileTag cid={value['/']} variant="link" onOpen={openFile} />
  }
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
    const ipfsMode = resolvedSchema?.format === 'ipfs'
    return (
      <StringLeafEditor
        value={value}
        literalOptions={literalOptions}
        hmMode={hmMode}
        ipfsMode={ipfsMode}
        onValue={onValue}
        rules={rules}
      />
    )
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

/** Extract a bare CID from a raw CID, an `ipfs://` URL, or a gateway `/ipfs/` URL. */
function linkCidFromText(text: string): string | null {
  let s = text.trim()
  const gateway = gatewayUrlToIpfs(s)
  if (gateway) s = gateway
  s = s.replace(/^ipfs:\/\//i, '')
  const first = s.split('/')[0] ?? ''
  return parseCidString(first) ? first : null
}

/** True when the text is explicitly an IPFS URL (not merely a bare CID string). */
function isIpfsUrlText(text: string): boolean {
  const t = text.trim()
  return /^ipfs:\/\//i.test(t) || !!gatewayUrlToIpfs(t)
}

/**
 * String leaf: a text field with schema-aware and IPFS behaviors layered on:
 * - hm-url/hm-profile schema formats → a search-assisted hypermedia reference.
 * - a literal union → a select with "Custom value…" back to free text; the
 *   select never unmounts a focused input (blur, which commits, must fire, so a
 *   late-arriving schema can't silently drop the draft).
 * - a dropped file → uploaded to IPFS, stored as an `ipfs://<cid>` reference and
 *   rendered as a file tag that opens the file in its own viewer.
 * - in IPLD mode (raw DAG-CBOR blobs), pasting an IPFS URL creates a native link.
 */
function StringLeafEditor({
  value,
  literalOptions,
  hmMode,
  ipfsMode,
  onValue,
  rules,
}: {
  value: string
  literalOptions: LiteralOption[] | undefined
  /** Schema format hm-url/hm-profile: search-assisted hypermedia reference input. */
  hmMode?: 'document' | 'profile'
  /** Schema format ipfs: the value is an `ipfs://<cid>` file reference — offer a
   * file picker (+ paste) when empty, and the file pill once set. */
  ipfsMode?: boolean
  onValue: (value: unknown) => void
  rules: ValueEditorRules
}) {
  const sel = useContext(SelectionStateContext)
  const fileUpload = sel?.fileUpload
  const openFile = sel?.openFile
  const ipfsFileInputRef = useRef<HTMLInputElement>(null)
  const [editingText, setEditingText] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const canDrop = !!fileUpload && !uploading
  const cid = findIpfsUrlCid(value)

  const uploadAndSet = async (file: File | undefined | null) => {
    if (!file || !fileUpload) return
    setUploading(true)
    try {
      const uploadedCid = await fileUpload(file)
      onValue(`ipfs://${uploadedCid.replace(/^ipfs:\/\//, '')}`)
    } catch (err) {
      toast.error(`Upload failed: ${err instanceof Error ? err.message : 'unknown error'}`)
    } finally {
      setUploading(false)
    }
  }
  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    await uploadAndSet(e.dataTransfer.files?.[0])
  }

  // Schema-driven presentations take over only when the field isn't actively
  // being edited as free text (a late-arriving schema must not unmount a
  // focused input — blur wouldn't fire and the draft would be lost).
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
    <div
      className={cn(
        'relative flex-1 rounded-md',
        dragOver && canDrop && 'ring-primary bg-primary/5 ring-2 outline-none',
      )}
      onDragOver={
        canDrop
          ? (e) => {
              e.preventDefault()
              if (!dragOver) setDragOver(true)
            }
          : undefined
      }
      onDragLeave={
        canDrop
          ? (e) => {
              // Ignore drag-leave bubbling from child elements.
              if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(false)
            }
          : undefined
      }
      onDrop={canDrop ? handleDrop : undefined}
    >
      {cid ? (
        <IpfsFileTag cid={cid} onOpen={openFile} onClear={() => onValue('')} />
      ) : (
        <div className="flex items-center gap-1">
          <CommitOnBlurInput
            initialValue={value}
            autoFocus={editingText}
            placeholder={ipfsMode ? 'ipfs:// URL or CID' : 'Empty Text'}
            // Save while typing (debounced) so edits persist without blurring.
            autosave
            // A pasted gateway URL (https://…/ipfs/<cid>) becomes an ipfs:// reference.
            normalize={gatewayUrlToIpfs}
            onFocusChange={(focused) => {
              // Focus latches free-text mode; blur (which commits) releases it so a
              // conforming committed value can render as the select again.
              setEditingText(focused)
            }}
            onCommit={(text) => {
              // In a raw DAG-CBOR blob, an IPFS URL becomes a native IPLD link
              // ({"/": cid}); in metadata it stays an ipfs:// string reference.
              if (rules.ipld && isIpfsUrlText(text)) {
                const linkCid = linkCidFromText(text)
                if (linkCid) {
                  onValue({'/': linkCid})
                  return
                }
              }
              onValue(text)
            }}
          />
          {/* An ipfs-typed field offers an explicit file picker (drop also works). */}
          {ipfsMode && fileUpload && (
            <>
              <input
                ref={ipfsFileInputRef}
                type="file"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  void uploadAndSet(file)
                }}
              />
              <Tooltip content="Upload a file to IPFS">
                <Button
                  variant="outline"
                  size="iconSm"
                  aria-label="Upload file to IPFS"
                  onClick={() => ipfsFileInputRef.current?.click()}
                >
                  <FileUp className="size-4" />
                </Button>
              </Tooltip>
            </>
          )}
        </div>
      )}
      {uploading && (
        <div className="bg-background/70 absolute inset-0 flex items-center justify-center gap-2 rounded-md">
          <Spinner className="size-4" />
          <span className="text-muted-foreground text-xs">Uploading…</span>
        </div>
      )}
    </div>
  )
}

/**
 * A tag for an IPFS reference — either an `ipfs://<cid>` string (`variant="file"`)
 * or a native IPLD link `{"/": cid}` (`variant="link"`). Clicking opens the
 * referenced blob; the optional clear button makes it editable again. Both
 * variants share the same pill so a pasted URL looks the same either way.
 */
function IpfsFileTag({
  cid,
  onOpen,
  onClear,
  variant = 'file',
}: {
  cid: string
  onOpen?: (cid: string) => void
  onClear?: () => void
  variant?: 'file' | 'link'
}) {
  const short = cid.length > 18 ? `${cid.slice(0, 9)}…${cid.slice(-6)}` : cid
  const Icon = variant === 'link' ? Link2 : FileText
  return (
    <div className="flex items-center gap-1">
      <Tooltip content={onOpen ? `Open ipfs://${cid}` : `ipfs://${cid}`}>
        <button
          type="button"
          disabled={!onOpen}
          onClick={onOpen ? () => onOpen(cid) : undefined}
          className={cn(
            'border-border bg-muted/60 inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-sm transition-colors',
            onOpen && 'hover:bg-muted cursor-pointer',
          )}
        >
          <Icon className="text-muted-foreground size-3.5 shrink-0" />
          <span className="truncate font-mono text-xs">{short}</span>
          {onOpen && <ExternalLink className="text-muted-foreground size-3 shrink-0" />}
        </button>
      </Tooltip>
      {onClear && (
        <Tooltip content={variant === 'link' ? 'Clear link' : 'Remove file reference'}>
          <Button
            variant="ghost"
            size="iconSm"
            aria-label={variant === 'link' ? 'Clear link' : 'Remove file reference'}
            className="text-muted-foreground"
            onClick={onClear}
          >
            <X className="size-3.5" />
          </Button>
        </Tooltip>
      )}
    </div>
  )
}

/**
 * IPLD link (`{"/": cid}`): a valid link renders as a file tag (matching the
 * `ipfs://` string reference); an empty/invalid link shows an input to enter a
 * CID or IPFS URL.
 */
function LinkValueEditor({value, onValue}: {value: {'/': string}; onValue: (value: unknown) => void}) {
  const sel = useContext(SelectionStateContext)
  const openUrl = sel?.openUrl
  const openFile = sel?.openFile
  const cid = value['/']
  const isValid = !!parseCidString(cid)
  // Prefer openFile (opens the linked blob in its own window); fall back to openUrl.
  const onOpen = openFile ?? (openUrl ? (c: string) => openUrl(`ipfs://${c}`) : undefined)

  if (isValid) {
    return <IpfsFileTag cid={cid} variant="link" onOpen={onOpen} onClear={() => onValue({'/': ''})} />
  }

  return (
    <div className="flex items-center gap-1">
      <Tooltip content="IPLD link — a native reference to another IPFS blob">
        <Link2 className={cn('size-3.5 shrink-0', cid ? 'text-destructive' : 'text-muted-foreground')} />
      </Tooltip>
      <CommitOnBlurInput
        key={cid}
        initialValue={cid}
        className="font-mono text-xs"
        placeholder="CID or ipfs:// URL"
        // Accept a bare CID, an ipfs:// URL, or a gateway /ipfs/ URL.
        normalize={linkCidFromText}
        onCommit={(text) => {
          const next = linkCidFromText(text) ?? text.trim()
          if (!parseCidString(next)) {
            toast.error('Not a valid CID or IPFS URL')
            return
          }
          onValue({'/': next})
        }}
      />
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
  // Rename and/or retype a field in one update: same key just replaces the
  // value; a new key drops the old (tombstone under metadata rules) and sets
  // the new key to the (already coerced) value.
  const editField = (key: string, newKey: string, newValue: unknown) => {
    if (newKey === key) {
      onValue({...value, [key]: newValue})
      return
    }
    if (rules.removeKeys === 'tombstone') {
      onValue({...value, [key]: null, [newKey]: newValue})
    } else {
      const next = {...value}
      delete next[key]
      next[newKey] = newValue
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
          onEditField={(newKey, newValue) => editField(key, newKey, newValue)}
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
  const [editing, setEditing] = useState(false)
  const handlers: SelectionHandlers = {getValue: () => item, setValue: onItem, remove: onRemove, rules}
  const getMenuActions = () => [
    ...baseMenuActions({value: item, handlers, isContainer, collapsed, setCollapsed}),
    {
      key: 'edit-type',
      label: 'Edit type',
      icon: <Pencil className="size-4" />,
      onClick: () => setEditing(true),
    },
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
  const {isSelected, rowProps} = useRowSelection(pathId(path), {
    path,
    handlers,
    isContainer,
    collapsed,
    setCollapsed,
    getMenuActions,
  })

  return (
    <div
      {...rowProps}
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
        'group/item relative flex items-start gap-2 outline-none',
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
      <FieldDialog
        open={editing}
        onOpenChange={setEditing}
        mode="edit"
        itemMode
        rules={rules}
        path={path.slice(0, -1)}
        initialType={valueToFieldType(item)}
        onSubmit={(_name, newType) => {
          if (newType !== valueToFieldType(item)) onItem(coerceFieldValue(item, newType, rules))
        }}
      />
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
const AUTOSAVE_DEBOUNCE_MS = 600

function CommitOnBlurInput({
  initialValue,
  placeholder,
  className,
  autoFocus,
  onCommit,
  onFocusChange,
  normalize,
  autosave = false,
}: {
  initialValue: string
  placeholder?: string
  className?: string
  autoFocus?: boolean
  onCommit: (text: string) => void
  onFocusChange?: (focused: boolean) => void
  /** Rewrite the text before it commits (e.g. gateway URL → `ipfs://`). Returns null to leave it unchanged. */
  normalize?: (text: string) => string | null
  /** Commit on a debounce while typing (not only on blur/Enter). */
  autosave?: boolean
}) {
  const [text, setText] = useState(initialValue)
  const focusedRef = useRef(false)
  const commit = (value: string) => onCommit(normalize?.(value) ?? value)

  // Resync from external value changes only when this field isn't being edited,
  // so an autosave round-trip (which updates `initialValue`) never moves the cursor.
  useEffect(() => {
    if (!focusedRef.current) setText(initialValue)
  }, [initialValue])

  // Autosave while typing: commit the debounced text. The draft state machine
  // further debounces the actual write, and the value is already staged before
  // any Publish click (which otherwise races the blur commit).
  const debouncedText = useDebounce(text, AUTOSAVE_DEBOUNCE_MS)
  useEffect(() => {
    if (!autosave || !focusedRef.current) return
    if (debouncedText !== initialValue) commit(debouncedText)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedText])

  return (
    <Input
      value={text}
      placeholder={placeholder}
      className={className}
      autoFocus={autoFocus}
      onFocus={() => {
        focusedRef.current = true
        onFocusChange?.(true)
      }}
      onChange={(e) => setText(e.target.value)}
      onPaste={
        normalize
          ? (e) => {
              // Convert a pasted gateway URL to ipfs:// immediately (so it
              // renders as a file tag) instead of waiting for blur.
              const pasted = e.clipboardData.getData('text')
              const converted = normalize(pasted)
              if (converted && converted !== pasted) {
                e.preventDefault()
                setText(converted)
                onCommit(converted)
              }
            }
          : undefined
      }
      onBlur={() => {
        focusedRef.current = false
        if (text !== initialValue) commit(text)
        onFocusChange?.(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') setText(initialValue)
      }}
    />
  )
}

export type NewFieldType = 'text' | 'number' | 'toggle' | 'object' | 'list' | 'null' | 'link' | 'bytes'

const FIELD_TYPE_LABEL: Record<NewFieldType, string> = {
  text: 'Text',
  number: 'Number',
  toggle: 'Toggle',
  object: 'Object',
  list: 'List',
  null: 'Null',
  link: 'IPFS Link',
  bytes: 'Bytes',
}

/** The types offerable under a given rule set (in menu order). */
function fieldTypeOptions(rules: ValueEditorRules): NewFieldType[] {
  const options: NewFieldType[] = ['text', 'number', 'toggle', 'object']
  if (rules.lists) options.push('list')
  if (!rules.hideNullEntries) options.push('null')
  if (rules.ipld) options.push('link', 'bytes')
  return options
}

/** The field type that best describes an existing value. */
export function valueToFieldType(value: unknown): NewFieldType {
  if (typeof value === 'string') return 'text'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'toggle'
  if (value === null || value === undefined) return 'null'
  if (isDagJsonLink(value)) return 'link'
  if (isDagJsonBytes(value)) return 'bytes'
  if (Array.isArray(value)) return 'list'
  return 'object'
}

/** The empty/starter value for a freshly-chosen field type. */
function defaultValueForType(type: NewFieldType): unknown {
  switch (type) {
    case 'text':
      return ''
    case 'number':
      return 0
    case 'toggle':
      return true
    case 'object':
      return {}
    case 'list':
      return []
    case 'null':
      return null
    case 'link':
      return {'/': ''}
    case 'bytes':
      return {'/': {bytes: ''}}
  }
}

/**
 * Convert a value to a new field type, preserving it across compatible
 * conversions (number ⇄ text, boolean ⇄ text/number, a valid CID string →
 * link) and otherwise falling back to the target type's default. Used when a
 * field's type is changed via the edit dialog.
 */
export function coerceFieldValue(value: unknown, toType: NewFieldType, rules: ValueEditorRules): unknown {
  if (valueToFieldType(value) === toType) return value
  switch (toType) {
    case 'text':
      if (typeof value === 'number' || typeof value === 'boolean') return String(value)
      return ''
    case 'number': {
      if (typeof value === 'boolean') return value ? 1 : 0
      if (typeof value === 'string') {
        const parsed = Number(value.trim())
        const valid = value.trim() !== '' && (rules.floats ? Number.isFinite(parsed) : Number.isInteger(parsed))
        if (valid) return parsed
      }
      return 0
    }
    case 'toggle':
      if (typeof value === 'string') return value.trim().toLowerCase() === 'true'
      if (typeof value === 'number') return value !== 0
      return defaultValueForType('toggle')
    case 'null':
      return null
    case 'link':
      if (typeof value === 'string') {
        const cid = value.trim().replace(/^ipfs:\/\//, '')
        if (parseCidString(cid)) return {'/': cid}
      }
      return {'/': ''}
    case 'object':
    case 'list':
    case 'bytes':
    default:
      return defaultValueForType(toType)
  }
}

/**
 * Builds the value for a newly-added field/item: a schema-instantiated starter
 * when the target path declares one and it matches the chosen type (so an enum
 * lands on a member, a required-nested object comes pre-populated), else the
 * plain default for the type. Respects an explicit type override — if the user
 * picked a type the schema starter doesn't match, the default wins.
 */
function useCreateFieldValue() {
  const ctx = useOnyxSchema()
  return useCallback(
    (targetPath: ValuePath, type: NewFieldType, rules: ValueEditorRules): unknown => {
      if (ctx) {
        const sub = onyxSubschema(ctx.rootSchema, targetPath, ctx.registry)
        const starter = sub && sub !== 'unresolved' ? seedValue(sub, ctx.registry) : undefined
        if (starter !== undefined && valueToFieldType(starter) === type && findInvalidValue(starter, rules) === null) {
          return starter
        }
      }
      return defaultValueForType(type)
    },
    [ctx],
  )
}

/**
 * Modal that captures a field's NAME and TYPE only — used both to add a new
 * field and to edit an existing field's name/type. The value itself is edited
 * inline in the row afterward, so name/type stay locked until reopened here.
 * `itemMode` drops the name input (list items are keyed by position, not name).
 */
function FieldDialog({
  open,
  onOpenChange,
  mode,
  itemMode = false,
  rules,
  path,
  existingKeys = [],
  initialName = '',
  initialType,
  onKeyTextChange,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'add' | 'edit'
  itemMode?: boolean
  rules: ValueEditorRules
  /** Path of the container the field lives in; enables schema field suggestions. */
  path?: ValuePath
  /** Sibling keys used for collision checks (excludes the field's own key in edit mode). */
  existingKeys?: string[]
  initialName?: string
  initialType: NewFieldType
  /** Reports the field-name text as it's typed (e.g. to prefetch schema-URL keys). */
  onKeyTextChange?: (keyText: string) => void
  onSubmit: (name: string, type: NewFieldType) => void
}) {
  const [name, setName] = useState(initialName)
  const [type, setType] = useState<NewFieldType>(initialType)
  const [error, setError] = useState<string | null>(null)

  // Seed the fields from the target field each time the dialog opens; ignore
  // later prop changes so a late-resolving schema can't clobber an in-progress
  // choice.
  useEffect(() => {
    if (!open) return
    setName(initialName)
    setType(initialType)
    setError(null)
  }, [open])

  const suggestions = useSchemaFieldSuggestions(path ?? [], existingKeys)
  const showSuggestions = !itemMode && !!path && suggestions.length > 0
  const options = fieldTypeOptions(rules)

  const submit = () => {
    if (itemMode) {
      onSubmit('', type)
      onOpenChange(false)
      return
    }
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Enter a field name')
      return
    }
    if (existingKeys.includes(trimmed)) {
      setError(`"${trimmed}" already exists`)
      return
    }
    if (trimmed === '/') {
      // DAG-JSON reserves the single "/" key for link and bytes forms.
      setError('"/" is a reserved field name in DAG-CBOR blobs')
      return
    }
    onSubmit(trimmed, type)
    onOpenChange(false)
  }

  const title = itemMode
    ? mode === 'add'
      ? 'Add item'
      : 'Edit item type'
    : mode === 'add'
      ? 'Add field'
      : 'Edit field'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {showSuggestions && (
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">Schema fields</span>
              <div className="flex flex-wrap items-center gap-1">
                {suggestions.map((suggestion) => (
                  <Button
                    key={suggestion.key}
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 font-mono text-xs"
                    onClick={() => {
                      setName(suggestion.key)
                      setError(null)
                      onKeyTextChange?.(suggestion.key)
                      if (suggestion.type && options.includes(suggestion.type)) setType(suggestion.type)
                    }}
                  >
                    {suggestion.key}
                    {suggestion.required ? ' *' : ''}
                  </Button>
                ))}
              </div>
            </div>
          )}
          {!itemMode && (
            <div className="flex flex-col gap-1">
              <label htmlFor="field-dialog-name" className="text-muted-foreground text-xs">
                Field name
              </label>
              <Input
                id="field-dialog-name"
                value={name}
                placeholder="Field name"
                autoFocus
                onChange={(e) => {
                  setName(e.target.value)
                  setError(null)
                  onKeyTextChange?.(e.target.value)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') submit()
                }}
              />
            </div>
          )}
          <div className="flex flex-col gap-1">
            <label className="text-muted-foreground text-xs">Type</label>
            <Select value={type} onValueChange={(v) => setType(v as NewFieldType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {options.map((option) => (
                  <SelectItem key={option} value={option}>
                    {FIELD_TYPE_LABEL[option]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {mode === 'edit' && (
            <p className="text-muted-foreground text-xs">
              Changing the type keeps the current value when compatible, otherwise resets it.
            </p>
          )}
          {error && <p className="text-destructive text-xs">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit}>
            <Check className="size-4" />
            {mode === 'add' ? 'Add' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * "+ Add field" affordance that opens the {@link FieldDialog} to pick a name +
 * type; the field is created with that type's starter value (schema-seeded
 * when the path declares one) and its value is then edited inline. `itemMode`
 * drops the name for appending list items.
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
  const createValue = useCreateFieldValue()
  // Pre-select the type a list's items schema calls for.
  const itemsSubschema = useSubschema(itemMode && path ? [...path, 0] : [])
  let initialType: NewFieldType = 'text'
  if (itemMode && itemsSubschema && itemsSubschema !== 'unresolved') {
    const suggested = suggestedFieldType(itemsSubschema)
    if (suggested && fieldTypeOptions(rules).includes(suggested)) initialType = suggested
  }

  return (
    <div>
      <Button
        variant="ghost"
        size="sm"
        className={cn('text-muted-foreground', compact && 'h-6 px-1 text-xs')}
        onClick={() => setOpen(true)}
      >
        <Plus className={compact ? 'size-3' : 'size-4'} />
        {itemMode ? 'Add item' : 'Add field'}
      </Button>
      <FieldDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) onKeyTextChange?.('')
        }}
        mode="add"
        itemMode={itemMode}
        rules={rules}
        path={path}
        existingKeys={existingKeys}
        initialName=""
        initialType={initialType}
        onKeyTextChange={onKeyTextChange}
        onSubmit={(name, type) => {
          const targetPath = itemMode ? [...(path ?? []), 0] : [...(path ?? []), name]
          onAdd(name, createValue(targetPath, type, rules))
          onKeyTextChange?.('')
        }}
      />
    </div>
  )
}
