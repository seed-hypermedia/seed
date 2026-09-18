import * as api from '@seed-hypermedia/agents-protocol'
import * as memory from '@/agent-memory'
import * as attachments from '@/session-attachments'

/** Captures a memory HTML file as an immutable, session-authorized app revision. */
export function createAgentApp(stateDir: string, sessionId: string, input: {title: string; path: string}) {
  const path = input.path.replace(/^(~\/memory\/|\/workspace\/)/, '')
  const file = memory.readMemoryFile(stateDir, path, api.MAX_AGENT_APP_BYTES)
  if (file.encoding !== 'utf8') throw new Error('App source must be UTF-8 HTML')
  const app = api.parseAgentApp({version: 1, title: input.title, html: file.content})
  const attachment = attachments.saveSessionAttachment(stateDir, sessionId, {
    name: 'app.seed-app.json',
    mimeType: api.AGENT_APP_MIME,
    content: new TextEncoder().encode(JSON.stringify(app)),
  })
  const url = `seed-app:${attachment.id}`
  return {
    summary: `Created app: ${app.title}`,
    url,
    attachmentId: attachment.id,
    link: `[Open app](${url})`,
    widget: '```seed-widget\n' + JSON.stringify({app: url, height: 400}) + '\n```',
    instructions:
      'Include link and/or widget verbatim in your reply. App references belong to this session. Re-run apps after editing source for a new revision. Nothing was published.',
  }
}
