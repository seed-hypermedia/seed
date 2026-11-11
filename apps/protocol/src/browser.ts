/** Commands for the visible, session-connected Seed desktop browser. No arbitrary JavaScript is exposed. */
export type BrowserCommand =
  | {action: 'snapshot'}
  | {action: 'screenshot'; document: string}
  | {action: 'click'; document: string; ref: string}
  | {action: 'type'; document: string; ref: string; text: string; clear?: boolean}
  | {action: 'press'; document: string; key: 'Enter' | 'Tab' | 'Escape' | 'Backspace' | 'ArrowDown' | 'ArrowUp'}
  | {action: 'scroll'; document: string; x?: number; y: number}
  | {action: 'navigate'; document: string; url: string}
  | {action: 'archive'; document: string}

/** One command delivered exactly once to the desktop that connected this session. */
export type BrowserRequest = {id: string; command: BrowserCommand}

/** Attaches an authenticated desktop window to a session, until disconnected or its lease expires. */
export type ConnectSessionBrowser = {_: 'ConnectSessionBrowser'; sessionId: string; connectionId: string}
/** Waits for the next command; an empty response is a lease heartbeat. */
export type PollSessionBrowser = {_: 'PollSessionBrowser'; sessionId: string; connectionId: string}
/** Completes one command. Page content remains private to the session/agent server. */
export type ResolveSessionBrowser = {
  _: 'ResolveSessionBrowser'
  sessionId: string
  connectionId: string
  requestId: string
  output?: Record<string, unknown>
  error?: string
}
/** Revokes a desktop connection and fails any outstanding commands. */
export type DisconnectSessionBrowser = {_: 'DisconnectSessionBrowser'; sessionId: string; connectionId: string}
/** Acknowledges browser connection lifecycle operations and returns polled commands. */
export type SessionBrowserResponse = {_: 'SessionBrowserResponse'; request?: BrowserRequest}
