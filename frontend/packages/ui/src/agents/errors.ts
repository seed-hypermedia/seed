import type {NoticeTone} from '@shm/ui/notice'
import {AgentServerError} from './client'

/**
 * How a failed agent-server request should be shown.
 *
 * The distinction that matters to a reader is not the error class but what it means for them: a
 * server that could not be reached is a degraded state (its content is hidden until it is back,
 * nothing is wrong with what they did), while a server that answered with a refusal is a real
 * error about this request. The first is a warning, the second an error.
 */
export type AgentErrorNotice = {
  tone: Extract<NoticeTone, 'error' | 'warning'>
  title: string
  detail?: string
}

/**
 * The messages `fetch` rejects with when the request never reached a server: Chromium, WebKit,
 * Firefox, and undici (Bun/Node) each phrase it differently. None of them name the server, which
 * is why the raw text — "Failed to fetch" — is never shown as-is.
 */
const NETWORK_ERROR_MESSAGES = [
  'failed to fetch',
  'load failed',
  'networkerror when attempting to fetch resource.',
  'fetch failed',
  'network request failed',
]

/** True when the request never reached the server (as opposed to the server answering). */
export function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error instanceof AgentServerError) return false
  const message = error.message.trim().toLowerCase()
  return NETWORK_ERROR_MESSAGES.some((candidate) => message === candidate || message.startsWith(`${candidate}:`))
}

/** The message to show for an unknown thrown value. */
export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return fallback
}

/**
 * Turns a failed agent-server request into a title, detail, and tone.
 *
 * @param error what the query rejected with
 * @param options.failed what did not happen, as a sentence-case headline: "Couldn’t load agents"
 * @param options.serverLabel how to name the server — `describeAgentServer(...)` — so the reader
 *   knows which of their servers is at fault. Omit when only one server is in play on screen.
 */
export function describeAgentError(
  error: unknown,
  options: {failed: string; serverLabel?: string | null},
): AgentErrorNotice {
  const {failed, serverLabel} = options
  if (isNetworkError(error)) {
    return {
      tone: 'warning',
      title: serverLabel ? `Can’t reach ${serverLabel}` : 'Can’t reach the agent server',
      detail: `${failed} because the server isn’t responding.`,
    }
  }
  if (error instanceof AgentServerError) {
    const refused = error.status === 401 || error.status === 403
    return {
      tone: 'error',
      title: failed,
      detail: serverLabel
        ? `${serverLabel} ${refused ? 'refused the request' : 'answered with an error'}: ${error.message}`
        : error.message,
    }
  }
  const message = errorMessage(error, '')
  return {
    tone: 'error',
    title: failed,
    detail: message ? (serverLabel ? `${serverLabel}: ${message}` : message) : undefined,
  }
}
