import {afterEach, describe, expect, test} from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as apps from '@/document-apps'
import * as memory from '@/agent-memory'

const directories: string[] = []
function state() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-document-app-test-'))
  directories.push(dir)
  return dir
}
afterEach(() => {
  for (const dir of directories.splice(0)) fs.rmSync(dir, {recursive: true, force: true})
})

describe('document app folders', () => {
  test('collects a folder whole, skips dotfiles, and turns a single HTML file into index.html', () => {
    const dir = state()
    memory.writeMemoryFile(dir, 'apps/counter/index.html', '<script src="assets/app.js"></script>')
    memory.writeMemoryFile(dir, 'apps/counter/assets/app.js', 'console.log(1)')
    memory.writeMemoryFile(dir, 'apps/counter/assets/logo.png', new Uint8Array([137, 80, 78, 71]))
    memory.writeMemoryFile(dir, 'apps/counter/.notes.md', 'private')
    const folder = apps.collectDocumentAppFiles(dir, '~/memory/apps/counter/')
    expect(folder.files.map((file) => file.path).sort()).toEqual(['assets/app.js', 'assets/logo.png', 'index.html'])
    expect(folder.bytes).toBe(folder.files.reduce((sum, file) => sum + file.content.byteLength, 0))
    expect(Array.from(folder.files.find((file) => file.path === 'assets/logo.png')!.content)).toEqual([137, 80, 78, 71])

    memory.writeMemoryFile(dir, 'apps/single.html', '<h1>One</h1>')
    expect(apps.collectDocumentAppFiles(dir, '/workspace/apps/single.html')).toEqual({
      files: [{path: 'index.html', content: new TextEncoder().encode('<h1>One</h1>')}],
      bytes: 12,
    })
  })
  test('refuses folders without an index, non-HTML single files, and paths outside memory', () => {
    const dir = state()
    memory.writeMemoryFile(dir, 'apps/noindex/app.js', 'x')
    memory.writeMemoryFile(dir, 'apps/data.json', '{}')
    expect(() => apps.collectDocumentAppFiles(dir, 'apps/noindex')).toThrow('index.html')
    expect(() => apps.collectDocumentAppFiles(dir, 'apps/data.json')).toThrow('HTML')
    expect(() => apps.collectDocumentAppFiles(dir, '../outside')).toThrow()
    expect(() => apps.collectDocumentAppFiles(dir, 'apps/missing')).toThrow()
  })
})
