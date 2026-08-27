import {useLocation} from '@remix-run/react'
import React, {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState} from 'react'

/**
 * App-wide state of the agents assistant panel on web.
 *
 * Desktop keeps this in the window's persisted nav state (`assistantOpen`, `assistantSessionId`)
 * and toggles it from the footer. Web has no window state, so the same three facts live here, in a
 * context mounted above the Remix outlet — it survives route changes, which remount every page and
 * with it the panel host — and are mirrored to localStorage so a reload restores the panel the way
 * a desktop relaunch does. Storage is read after mount: the server and the first client render
 * agree on "closed", and the panel body is client-only anyway.
 *
 * Open state is a three-way preference: open, closed, or never decided. The distinction matters
 * for first arrival — the panel opens itself once for a reader who has never chosen (see
 * {@link useAssistantAutoOpen}), and only an actual close is remembered as "closed", so a visit
 * that never surfaced the panel (signed out, on a phone) does not count as a decision.
 */
export type AssistantPanelState = {
  isOpen: boolean
  /**
   * Whether the reader has ever opened or closed the panel: true once a preference is stored,
   * false when none is, undefined until storage has been read. Only `false` invites auto-open.
   */
  openDecided: boolean | undefined
  /** Serialized `AssistantSessionRef` of the session the panel last showed, or null. */
  sessionId: string | null
  /** Serialized agent ref the user last chose in the panel's agent dropdown, or null. */
  agentId: string | null
  /**
   * Monotonic counter; each increment asks the panel to start a new chat. A counter rather than a
   * flag so a second click while a draft is already open re-focuses the composer.
   */
  newChatRequest: number
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
/** Stored open preference: '1' open, '0' closed; absent means never decided. */
type OpenPreference = '1' | '0'
const AGENT_STORAGE_KEY = 'seed.assistant.agent'

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // Private mode or a full quota: the panel still works for this page load.
  }
}

const AssistantPanelContext = createContext<AssistantPanelState | null>(null)

export function AssistantPanelProvider({children}: {children: React.ReactNode}) {
  const [isOpen, setIsOpen] = useState(false)
  const [openDecided, setOpenDecided] = useState<boolean | undefined>(undefined)
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
    setOpenDecided(storedOpen === '1' || storedOpen === '0')
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

  // Written only once decided: the pre-decision default would otherwise be stored as a "closed"
  // preference on the first visit, and the panel would never get to introduce itself.
  useEffect(() => {
    if (!hydrated || !openDecided) return
    writeStorage(OPEN_STORAGE_KEY, (isOpen ? '1' : '0') satisfies OpenPreference)
  }, [hydrated, openDecided, isOpen])

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
    setOpenDecided(true)
  }, [])
  const close = useCallback(() => {
    setIsOpen(false)
    setOpenDecided(true)
  }, [])
  const toggle = useCallback(() => {
    setIsOpen((prev) => !prev)
    setOpenDecided(true)
  }, [])
  const requestNewChat = useCallback(() => {
    setIsOpen(true)
    setOpenDecided(true)
    setNewChatRequest((prev) => prev + 1)
  }, [])
  const setSessionId = useCallback((next: string | null) => setSessionIdState(next), [])
  const setAgentId = useCallback((next: string | null) => setAgentIdState(next), [])

  const value = useMemo<AssistantPanelState>(
    () => ({
      isOpen,
      openDecided,
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
      openDecided,
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

/** Narrow viewports get the panel over the whole page, which is not something to spring on arrival. */
const NARROW_VIEWPORT_QUERY = '(max-width: 660px)'

/**
 * Opens the panel on its own the first time a reader could use it.
 *
 * `available` is the host's word that there is an agent to talk to and someone signed in to talk
 * to it. Only a reader who has never opened or closed the panel is introduced this way — once they
 * close it, that is remembered and it stays closed until they ask for it. Phones are exempt: there
 * the panel covers the page. The viewport is re-checked at the moment of opening, since the media
 * hook settles a render after mount and an effect in that first pass would still read "wide".
 */
export function useAssistantAutoOpen(available: boolean) {
  const {openDecided, open} = useAssistantPanel()
  useEffect(() => {
    if (!available || openDecided !== false) return
    if (typeof window.matchMedia === 'function' && window.matchMedia(NARROW_VIEWPORT_QUERY).matches) return
    open()
  }, [available, openDecided, open])
}

const noop = () => {}
const INERT_STATE: AssistantPanelState = {
  isOpen: false,
  openDecided: true,
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
