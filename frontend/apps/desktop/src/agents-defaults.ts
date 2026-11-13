import {DEFAULT_DESKTOP_AGENTS_URL} from '@shm/shared/constants'

// Dev runs the app environment on the port from .env.vars; release builds use the baked-in default.
const LOCAL_DEFAULT_AGENT_SERVER_URL = DEFAULT_DESKTOP_AGENTS_URL
// The app environment on the gateway's own origin: hyper.media proxies /hm/api/apps to it.
const PRODUCTION_DEFAULT_AGENT_SERVER_URL = 'https://hyper.media/hm/api/apps'

/** Returns the built-in default app environment URL for the current desktop runtime. */
export function getDefaultAgentServerUrl() {
  return process.env.NODE_ENV === 'production' ? PRODUCTION_DEFAULT_AGENT_SERVER_URL : LOCAL_DEFAULT_AGENT_SERVER_URL
}

/**
 * The built-in default app environment URL for the current desktop runtime.
 *
 * Kept in its own module (separate from the platform adapter) so settings UI and tests can import
 * the constant without pulling in the editor and gRPC modules the adapter needs.
 */
export const DEFAULT_AGENT_SERVER_URL = getDefaultAgentServerUrl()
