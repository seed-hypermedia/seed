import {afterEach, describe, expect, test} from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  AgentMemoryError,
  deleteMemoryPath,
  downloadToMemory,
  listMemory,
  listMemoryDir,
  memoryRootPath,
  readMemoryFile,
  resolveMemoryPath,
  summarizeMemoryTopLevel,
  summarizeMemoryTopLevelAsync,
  writeMemoryFile,
} from '@/agent-memory'

function withStateDir(run: (stateDir: string) => void | Promise<void>): void | Promise<void> {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-memory-test-'))
  const cleanup = () => fs.rmSync(stateDir, {recursive: true, force: true})
  try {
    const result = run(stateDir)
    if (result instanceof Promise) return result.finally(cleanup)
    cleanup()
  } catch (error) {
    cleanup()
    throw error
  }
}

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

describe('agent memory', () => {
  test('writes, lists, reads, and deletes files', () => {
    withStateDir((stateDir) => {
      const written = writeMemoryFile(stateDir, 'notes/todo.md', '# Todo\n\n- remember this\n')
      expect(written).toMatchObject({path: 'notes/todo.md', type: 'file', mimeType: 'text/markdown'})
      writeMemoryFile(stateDir, 'MEMORY.md', 'index')

      const listed = listMemory(stateDir)
      expect(listed.entries.map((entry) => `${entry.type}:${entry.path}`)).toEqual([
        'file:MEMORY.md',
        'dir:notes',
        'file:notes/todo.md',
      ])
      expect(listed.totalBytes).toBeGreaterThan(0)

      const file = readMemoryFile(stateDir, 'notes/todo.md')
      expect(file.encoding).toBe('utf8')
      expect(file.content).toBe('# Todo\n\n- remember this\n')

      expect(deleteMemoryPath(stateDir, 'notes')).toEqual({path: 'notes', deleted: true})
      expect(deleteMemoryPath(stateDir, 'notes')).toEqual({path: 'notes', deleted: false})
      expect(listMemory(stateDir).entries.map((entry) => entry.path)).toEqual(['MEMORY.md'])
    })
  })

  test('lists one directory level at a time with entry counts', () => {
    withStateDir((stateDir) => {
      writeMemoryFile(stateDir, 'MEMORY.md', 'index')
      writeMemoryFile(stateDir, 'notes/todo.md', 'todo')
      writeMemoryFile(stateDir, 'notes/deep/nested.md', 'nested')
      writeMemoryFile(stateDir, 'notes/deep/other.md', 'other')

      // Root level: the nested files are not listed, only the top-level dir with its count.
      const root = listMemoryDir(stateDir)
      expect(root.path).toBe('')
      expect(root.entries.map((entry) => `${entry.type}:${entry.path}`)).toEqual(['file:MEMORY.md', 'dir:notes'])
      expect(root.entries.find((entry) => entry.path === 'notes')?.entryCount).toBe(2)
      expect(root.totalBytes).toBe(5)

      const notes = listMemoryDir(stateDir, 'notes')
      expect(notes.path).toBe('notes')
      expect(notes.entries.map((entry) => `${entry.type}:${entry.path}`)).toEqual([
        'dir:notes/deep',
        'file:notes/todo.md',
      ])
      expect(notes.entries.find((entry) => entry.path === 'notes/deep')?.entryCount).toBe(2)

      // '/' means the root; a missing dir 404s; a file path is rejected with guidance.
      expect(listMemoryDir(stateDir, '/').entries).toHaveLength(2)
      expect(() => listMemoryDir(stateDir, 'nope')).toThrow(AgentMemoryError)
      expect(() => listMemoryDir(stateDir, 'MEMORY.md')).toThrow('not a directory')
    })
  })

  test('round-trips binary files with inferred mime types', () => {
    withStateDir((stateDir) => {
      const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 3])
      const written = writeMemoryFile(stateDir, 'media/cover.png', pngBytes)
      expect(written).toMatchObject({path: 'media/cover.png', type: 'file', size: 12, mimeType: 'image/png'})

      const file = readMemoryFile(stateDir, 'media/cover.png')
      expect(file.encoding).toBe('binary')
      expect(file.mimeType).toBe('image/png')
      expect(file.content).toBeUndefined()
      expect(Array.from(file.data ?? [])).toEqual(Array.from(pngBytes))
    })
  })

  test('normalizes friendly path variants to the same file', () => {
    withStateDir((stateDir) => {
      writeMemoryFile(stateDir, '/notes//./deep\\file.txt', 'hello')
      expect(readMemoryFile(stateDir, 'notes/deep/file.txt').content).toBe('hello')
      expect(resolveMemoryPath(stateDir, './a/b').relPath).toBe('a/b')
    })
  })

  test('rejects traversal, absolute escapes, and invalid paths', () => {
    withStateDir((stateDir) => {
      for (const bad of ['../escape.txt', 'a/../../escape.txt', 'a/..', '', '/', 'a\0b', 42 as unknown as string]) {
        expect(() => resolveMemoryPath(stateDir, bad)).toThrow(AgentMemoryError)
      }
      // Resolved paths always stay inside the memory root.
      const {absPath} = resolveMemoryPath(stateDir, 'ok.txt')
      expect(absPath.startsWith(memoryRootPath(stateDir) + path.sep)).toBe(true)
    })
  })

  test('accepts large text and binary writes and reads them back', () => {
    withStateDir((stateDir) => {
      // Sizes chosen above the caps that used to exist: memory has no size limits.
      const bigText = 'x'.repeat(2 * 1024 * 1024)
      writeMemoryFile(stateDir, 'big.txt', bigText)
      const readBack = readMemoryFile(stateDir, 'big.txt')
      expect(readBack.encoding).toBe('utf8')
      expect(readBack.content?.length).toBe(bigText.length)

      writeMemoryFile(stateDir, 'big.bin', new Uint8Array(3 * 1024 * 1024))
      expect(readMemoryFile(stateDir, 'big.bin').encoding).toBe('binary')
    })
  })

  test('refuses to read through symlinks and skips them in listings', () => {
    withStateDir((stateDir) => {
      writeMemoryFile(stateDir, 'real.txt', 'data')
      const outside = path.join(stateDir, 'outside-secret.txt')
      fs.writeFileSync(outside, 'secret')
      fs.symlinkSync(outside, path.join(memoryRootPath(stateDir), 'link.txt'))

      expect(() => readMemoryFile(stateDir, 'link.txt')).toThrow(AgentMemoryError)
      expect(() => writeMemoryFile(stateDir, 'link.txt', 'nope')).toThrow(AgentMemoryError)
      expect(listMemory(stateDir).entries.map((entry) => entry.path)).toEqual(['real.txt'])
    })
  })

  test('refuses operations through symlinked parent directories', () => {
    withStateDir((stateDir) => {
      const outside = path.join(stateDir, 'outside')
      fs.mkdirSync(outside)
      fs.writeFileSync(path.join(outside, 'existing.txt'), 'secret')
      fs.mkdirSync(memoryRootPath(stateDir), {recursive: true})
      fs.symlinkSync(outside, path.join(memoryRootPath(stateDir), 'link'))

      expect(() => readMemoryFile(stateDir, 'link/existing.txt')).toThrow(AgentMemoryError)
      expect(() => listMemoryDir(stateDir, 'link')).toThrow(AgentMemoryError)
      expect(() => writeMemoryFile(stateDir, 'link/escaped.txt', 'escaped')).toThrow(AgentMemoryError)
      expect(() => deleteMemoryPath(stateDir, 'link/existing.txt')).toThrow(AgentMemoryError)
      expect(fs.readFileSync(path.join(outside, 'existing.txt'), 'utf8')).toBe('secret')
      expect(fs.existsSync(path.join(outside, 'escaped.txt'))).toBe(false)
    })
  })

  test('errors when reading a directory or a missing file', () => {
    withStateDir((stateDir) => {
      writeMemoryFile(stateDir, 'dir/file.txt', 'x')
      expect(() => readMemoryFile(stateDir, 'dir')).toThrow('directory')
      expect(() => readMemoryFile(stateDir, 'missing.txt')).toThrow('not found')
      expect(() => writeMemoryFile(stateDir, 'dir', 'x')).toThrow('directory')
    })
  })

  test('summarizes the top level without expanding subfolders', async () => {
    await withStateDir(async (stateDir) => {
      writeMemoryFile(stateDir, 'MEMORY.md', 'index')
      writeMemoryFile(stateDir, 'notes/a.md', 'aa')
      writeMemoryFile(stateDir, 'notes/deep/b.md', 'bbb')
      writeMemoryFile(stateDir, 'media/pic.png', new Uint8Array(4))

      // The summary walk stops at MAX_MEMORY_SUMMARY_DEPTH: notes/deep/ is seen but not entered,
      // so its file is absent, the counts read as minimums, and the result flags truncation.
      const summary = summarizeMemoryTopLevel(stateDir)
      expect(summary.totalFiles).toBe(3)
      expect(summary.truncated).toBe(true)
      expect(summary.entries).toEqual([
        {name: 'MEMORY.md', type: 'file', size: 5},
        {name: 'media', type: 'dir', size: 4, fileCount: 1},
        {name: 'notes', type: 'dir', size: 2, fileCount: 1},
      ])

      // The async rollup used by background refreshes reports the same result.
      expect(await summarizeMemoryTopLevelAsync(stateDir)).toEqual(summary)
    })
  })

  test('the depth budget skips a deep subtree without hiding its siblings', () => {
    withStateDir((stateDir) => {
      writeMemoryFile(stateDir, 'store/aa/bb/cc/huge.bin', new Uint8Array(8))
      writeMemoryFile(stateDir, 'zz-notes/keep.md', 'kept')

      const listed = listMemory(stateDir, {maxDepth: 2})
      expect(listed.truncated).toBe(true)
      const paths = listed.entries.map((entry) => entry.path)
      // store/aa is listed but not entered; the later sibling tree is still fully visited.
      expect(paths).toContain('store/aa')
      expect(paths).not.toContain('store/aa/bb')
      expect(paths).toContain('zz-notes/keep.md')
    })
  })

  test('bounds the recursive walk so a huge memory cannot block the server', () => {
    withStateDir((stateDir) => {
      for (let i = 0; i < 8; i++) writeMemoryFile(stateDir, `bulk/file-${String(i).padStart(2, '0')}.txt`, `${i}`)

      const unbounded = listMemory(stateDir)
      expect(unbounded.truncated).toBe(false)
      expect(unbounded.entries).toHaveLength(9) // the dir plus its 8 files

      const capped = listMemory(stateDir, {maxEntries: 4})
      expect(capped.truncated).toBe(true)
      expect(capped.entries).toHaveLength(4)
      // The cap stops the walk itself, not just the result: bytes cover only visited files.
      expect(capped.totalBytes).toBeLessThan(unbounded.totalBytes)
    })
  })

  test('downloads a web file into memory with a derived name and extension', async () => {
    await withStateDir(async (stateDir) => {
      const jpgBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3])
      globalThis.fetch = (async () =>
        new Response(jpgBytes, {headers: {'content-type': 'image/jpeg'}})) as unknown as typeof fetch

      // Explicit path without an extension gains one from the content type.
      const explicit = await downloadToMemory(stateDir, 'https://example.com/photos/cat', 'media/cat')
      expect(explicit.entry).toMatchObject({path: 'media/cat.jpg', size: 7, mimeType: 'image/jpeg'})
      expect(explicit.contentType).toBe('image/jpeg')

      // Default path lands in downloads/ named from the URL.
      const derived = await downloadToMemory(stateDir, 'https://example.com/photos/cat.jpg', undefined)
      expect(derived.entry.path).toBe('downloads/cat.jpg')
      expect(readMemoryFile(stateDir, 'downloads/cat.jpg').encoding).toBe('binary')
    })
  })

  test('rejects bad download URLs', async () => {
    await withStateDir(async (stateDir) => {
      await expect(downloadToMemory(stateDir, 'ftp://example.com/x', undefined)).rejects.toThrow('http or https')
      await expect(downloadToMemory(stateDir, 'not a url', undefined)).rejects.toThrow('Invalid download URL')
    })
  })

  test('reports failed downloads with an upstream error', async () => {
    await withStateDir(async (stateDir) => {
      globalThis.fetch = (async () => new Response('missing', {status: 404})) as unknown as typeof fetch
      await expect(downloadToMemory(stateDir, 'https://example.com/gone.png', undefined)).rejects.toThrow('HTTP 404')
    })
  })
})
