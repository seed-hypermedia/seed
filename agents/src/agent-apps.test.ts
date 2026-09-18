import {afterEach, describe, expect, test} from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as apps from '@/agent-apps'
import * as memory from '@/agent-memory'
import * as attachments from '@/session-attachments'
import * as api from '@seed-hypermedia/agents-protocol'

const directories: string[] = []
function state() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-app-test-'))
  directories.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of directories.splice(0)) fs.rmSync(dir, {recursive: true, force: true})
})

describe('apps', () => {
  test('captures immutable revisions, isolates sessions, and returns discoverable rendering references', () => {
    const dir = state()
    memory.writeMemoryFile(dir, 'apps/demo.html', '<h1>First</h1>')
    const first = apps.createAgentApp(dir, 'session-a', {title: 'Demo', path: '~/memory/apps/demo.html'})
    expect(api.agentAppId(first.url)).toBe(first.attachmentId)
    expect(first.widget).toContain('```seed-widget')
    expect(apps.createAgentApp(dir, 'session-a', {title: 'Demo', path: '/workspace/apps/demo.html'})).toEqual(first)
    memory.writeMemoryFile(dir, 'apps/demo.html', '<h1>Second</h1>')
    const second = apps.createAgentApp(dir, 'session-a', {title: 'Demo', path: 'apps/demo.html'})
    expect(second.url).not.toBe(first.url)
    const stored = attachments.readSessionAttachment(dir, 'session-a', first.attachmentId)
    expect(stored.info.mimeType).toBe(api.AGENT_APP_MIME)
    expect(JSON.parse(new TextDecoder().decode(stored.data)).html).toBe('<h1>First</h1>')
    expect(() => attachments.readSessionAttachment(dir, 'session-b', first.attachmentId)).toThrow('not found')
  })
  test('rejects traversal, symlinks, binary, oversized source and invalid titles', () => {
    const dir = state()
    memory.writeMemoryFile(dir, 'source.html', '<p>ok</p>')
    memory.writeMemoryFile(dir, 'binary.html', new Uint8Array([0, 255]))
    memory.writeMemoryFile(dir, 'large.html', 'a'.repeat(api.MAX_AGENT_APP_BYTES + 1))
    fs.symlinkSync(path.join(dir, 'memory/source.html'), path.join(dir, 'memory/link.html'))
    for (const file of ['../outside.html', 'link.html', 'binary.html', 'large.html']) {
      expect(() => apps.createAgentApp(dir, 'session', {title: 'Demo', path: file})).toThrow()
    }
    expect(() => apps.createAgentApp(dir, 'session', {title: ' ', path: 'source.html'})).toThrow()
    expect(api.agentAppId('seed-app:../escape')).toBeNull()
    expect(api.agentAppId(`seed-app:${'a'.repeat(64)}?query`)).toBeNull()
  })
})
