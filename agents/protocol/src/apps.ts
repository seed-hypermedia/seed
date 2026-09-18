/** MIME type of a versioned, session-private client-side application. */
export const AGENT_APP_MIME = 'application/vnd.seed.app+json'
/** Maximum UTF-8 source size of a single-file app. */
export const MAX_AGENT_APP_BYTES = 1024 * 1024
/** A self-contained app; dependencies and assets must be bundled into its HTML. */
export type AgentApp = {version: 1; title: string; html: string}

/** Validates an app at the signed API / desktop IPC boundary. */
export function parseAgentApp(value: unknown): AgentApp {
  const app = value as Partial<AgentApp> | null
  if (
    !app ||
    app.version !== 1 ||
    typeof app.title !== 'string' ||
    !app.title.trim() ||
    app.title.length > 120 ||
    typeof app.html !== 'string' ||
    !app.html.trim() ||
    new TextEncoder().encode(app.html).byteLength > MAX_AGENT_APP_BYTES
  )
    throw new Error('Invalid Seed app: expected a title and at most 1 MiB of self-contained HTML')
  return {version: 1, title: app.title, html: app.html}
}

/** Extracts a content-addressed app reference; references resolve within the current session. */
export function agentAppId(reference: string): string | null {
  return /^seed-app:([0-9a-f]{64})$/.exec(reference)?.[1] ?? null
}

/**
 * Builds the same isolated wrapper for chat and the integrated browser. The extra iframe is
 * intentional: its parent's frame-src policy blocks even script-initiated navigation off-app.
 * Neither frame has same-origin privileges. Only bounded result messages are relayed outward.
 */
export function agentAppDocument(app: AgentApp): string {
  const escape = (text: string) => text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`)
  const policy =
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'"
  const source = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${escape(policy)}">${
    app.html
  }`
  const bytes = new TextEncoder().encode(source)
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; frame-src data:; base-uri 'none'; form-action 'none'">
<meta name="referrer" content="no-referrer"><title>${escape(app.title)}</title>
<style>html,body{margin:0;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%;display:block}</style></head><body>
<iframe title="${escape(
    app.title,
  )}" sandbox="allow-scripts" referrerpolicy="no-referrer" src="data:text/html;base64,${btoa(binary)}"></iframe>
<script>addEventListener('message', event => {
  if (event.source !== document.querySelector('iframe').contentWindow || event.data?.type !== 'seed-app-result') return;
  try { const value = JSON.stringify(event.data.value); if (typeof value === 'string' && value.length <= 16384)
    parent.postMessage({type:'seed-app-result', value:JSON.parse(value)}, '*'); } catch {}
});</script></body></html>`
}
