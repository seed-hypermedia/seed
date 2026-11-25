import {useLocation} from '@remix-run/react'
import React, {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react'

/**
 * App-wide state of the agents assistant panel on web.
 *
 * Desktop keeps this in the window's persisted nav state (`assistantOpen`, `assistantSessionId`)
 * and toggles it from the footer. Web has no window state, so the same three facts live here, in a
 * context mounted above the Remix outlet — it survives route changes, which remount every page and
 * with it the panel host — and are mirrored to sessionStorage so a reload of the same tab restores
 * the panel. Not localStorage: a page opened in a new tab, from a link or a search result, is a
 * fresh visit and starts with the panel closed and no chat open, rather than carrying over whatever
 * chat was last open on some other site. The panel only ever opens because the reader asked.
 * Storage is read after mount: the server and the first client render agree on "closed", and the
 * panel body is client-only anyway.
 *
 * Narrow viewports add one more fact, not persisted: whether the reader opened the panel themselves
 * during this page load. There the panel covers the whole page, which only an explicit open may do
 * — a state restored by a reload must not take the page over. See {@link AssistantPanelState.openedByReader}.
 */
export type AssistantPanelState = {
  isOpen: boolean
  /**
   * True once the reader opened the panel themselves (header toggle, menu item, new chat) during
   * this page load; false after a close, and never set by a restored preference.
   * The host shows the full-screen panel on narrow viewports only while this is true.
   */
  openedByReader: boolean
  /** Serialized `AssistantSessionRef` of the session the panel last showed, or null. */
  sessionId: string | null
  /** Serialized agent ref the user last chose in the panel's agent dropdown, or null. */
  agentId: string | null
  /**
   * Monotonic counter; each increment asks the panel to start a new chat. A counter rather than a
   * flag so a second click while a draft is already open re-focuses the composer.
   */
  newChatRequest: number
  /** Opens the panel at the reader's request. */
  open: () => void
  close: () => void
  toggle: () => void
  /** Opens the panel (if needed) and starts a new chat in the last-used agent context. */
  requestNewChat: () => void
  setSessionId: (sessionId: string | null) => void
  setAgentId: (agentId: string | null) => void
}

const OPEN_STORAGE_KEY = 'seed.assistant.open'
const SESSION_STORAGE_KEY = 'seed.assistant.session'
/** Stored open state: '1' open, '0' closed. */
type OpenPreference = '1' | '0'
const AGENT_STORAGE_KEY = 'seed.assistant.agent'

function readStorage(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) window.sessionStorage.removeItem(key)
    else window.sessionStorage.setItem(key, value)
  } catch {
    // Private mode or a full quota: the panel still works for this page load.
  }
}

const AssistantPanelContext = createContext<AssistantPanelState | null>(null)

export function AssistantPanelProvider({children}: {children: React.ReactNode}) {
  const [isOpen, setIsOpen] = useState(false)
  const [openedByReader, setOpenedByReader] = useState(false)
  const [sessionId, setSessionIdState] = useState<string | null>(null)
  const [agentId, setAgentIdState] = useState<string | null>(null)
  const [newChatRequest, setNewChatRequest] = useState(0)
  // Nothing is written back until the stored values have been read, or the pre-hydration defaults
  // would clobber what the previous visit saved. State rather than a ref: a ref flipped inside the
  // read effect is already true when the write effects run in that same commit — with the stale
  // defaults — which cleared the saved flag (and StrictMode's second effect pass then re-read the
  // cleared key). As state, the writes only start on the render that carries the restored values.
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    const storedOpen = readStorage(OPEN_STORAGE_KEY)
    setIsOpen(storedOpen === '1')
    setSessionIdState(readStorage(SESSION_STORAGE_KEY))
    setAgentIdState(readStorage(AGENT_STORAGE_KEY))
    setHydrated(true)
  }, [])

  // A remounted panel counts new-chat requests from zero (desktop resets the counter when it
  // toggles the panel for the same reason). On web the panel remounts with every route change, so
  // a counter left over from an earlier request would open the next page's panel straight into a
  // draft instead of restoring the last session.
  const location = useLocation()
  const lastPathname = useRef(location.pathname)
  useEffect(() => {
    if (lastPathname.current === location.pathname) return
    lastPathname.current = location.pathname
    setNewChatRequest(0)
  }, [location.pathname])

  useEffect(() => {
    if (!hydrated) return
    writeStorage(OPEN_STORAGE_KEY, (isOpen ? '1' : '0') satisfies OpenPreference)
  }, [hydrated, isOpen])

  useEffect(() => {
    if (!hydrated) return
    writeStorage(SESSION_STORAGE_KEY, sessionId)
  }, [hydrated, sessionId])

  useEffect(() => {
    if (!hydrated) return
    writeStorage(AGENT_STORAGE_KEY, agentId)
  }, [hydrated, agentId])

  const open = useCallback(() => {
    setIsOpen(true)
    setOpenedByReader(true)
  }, [])
  const close = useCallback(() => {
    setIsOpen(false)
    setOpenedByReader(false)
  }, [])
  const toggle = useCallback(() => {
    setIsOpen(!isOpen)
    setOpenedByReader(!isOpen)
  }, [isOpen])
  const requestNewChat = useCallback(() => {
    setIsOpen(true)
    setOpenedByReader(true)
    setNewChatRequest((prev) => prev + 1)
  }, [])
  const setSessionId = useCallback((next: string | null) => setSessionIdState(next), [])
  const setAgentId = useCallback((next: string | null) => setAgentIdState(next), [])

  const value = useMemo<AssistantPanelState>(
    () => ({
      isOpen,
      openedByReader,
      sessionId,
      agentId,
      newChatRequest,
      open,
      close,
      toggle,
      requestNewChat,
      setSessionId,
      setAgentId,
    }),
    [
      isOpen,
      openedByReader,
      sessionId,
      agentId,
      newChatRequest,
      open,
      close,
      toggle,
      requestNewChat,
      setSessionId,
      setAgentId,
    ],
  )
  return <AssistantPanelContext.Provider value={value}>{children}</AssistantPanelContext.Provider>
}

/** The assistant panel state, or an inert closed panel outside the provider (tests, isolated renders). */
export function useAssistantPanel(): AssistantPanelState {
  const context = useContext(AssistantPanelContext)
  return context ?? INERT_STATE
}

const noop = () => {}
const INERT_STATE: AssistantPanelState = {
  isOpen: false,
  openedByReader: false,
  sessionId: null,
  agentId: null,
  newChatRequest: 0,
  open: noop,
  close: noop,
  toggle: noop,
  requestNewChat: noop,
  setSessionId: noop,
  setAgentId: noop,
}
