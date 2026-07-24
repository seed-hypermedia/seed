import {afterEach, describe, expect, test} from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  AgentMemoryError,
  MAX_MEMORY_FILE_BYTES,
  MAX_MEMORY_TEXT_BYTES,
  deleteMemoryPath,
  downloadToMemory,
  listMemory,
  memoryRootPath,
  readMemoryFile,
  resolveMemoryPath,
  summarizeMemoryTopLevel,
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

  test('bounds text writes, binary writes, and reads separately', () => {
    withStateDir((stateDir) => {
      expect(() => writeMemoryFile(stateDir, 'big.txt', 'x'.repeat(MAX_MEMORY_TEXT_BYTES + 1))).toThrow('byte limit')
      // Binary content is allowed beyond the text limit.
      writeMemoryFile(stateDir, 'big.bin', new Uint8Array(MAX_MEMORY_TEXT_BYTES + 1))
      expect(readMemoryFile(stateDir, 'big.bin').encoding).toBe('binary')

      // A sparse file over the hard per-file limit is refused on read.
      const hugePath = path.join(memoryRootPath(stateDir), 'huge.bin')
      fs.writeFileSync(hugePath, '')
      fs.truncateSync(hugePath, MAX_MEMORY_FILE_BYTES + 1)
      expect(() => readMemoryFile(stateDir, 'huge.bin')).toThrow('too large')
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

  test('errors when reading a directory or a missing file', () => {
    withStateDir((stateDir) => {
      writeMemoryFile(stateDir, 'dir/file.txt', 'x')
      expect(() => readMemoryFile(stateDir, 'dir')).toThrow('directory')
      expect(() => readMemoryFile(stateDir, 'missing.txt')).toThrow('not found')
      expect(() => writeMemoryFile(stateDir, 'dir', 'x')).toThrow('directory')
    })
  })

  test('summarizes the top level without expanding subfolders', async () => {
    withStateDir((stateDir) => {
      writeMemoryFile(stateDir, 'MEMORY.md', 'index')
      writeMemoryFile(stateDir, 'notes/a.md', 'aa')
      writeMemoryFile(stateDir, 'notes/deep/b.md', 'bbb')
      writeMemoryFile(stateDir, 'media/pic.png', new Uint8Array(4))

      const summary = summarizeMemoryTopLevel(stateDir)
      expect(summary.totalFiles).toBe(4)
      expect(summary.entries).toEqual([
        {name: 'MEMORY.md', type: 'file', size: 5},
        {name: 'media', type: 'dir', size: 4, fileCount: 1},
        {name: 'notes', type: 'dir', size: 5, fileCount: 2},
      ])
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

  test('rejects downloads that exceed the file size limit or use bad URLs', async () => {
    await withStateDir(async (stateDir) => {
      globalThis.fetch = (async () =>
        new Response('x', {
          headers: {'content-type': 'text/plain', 'content-length': String(MAX_MEMORY_FILE_BYTES + 1)},
        })) as unknown as typeof fetch
      await expect(downloadToMemory(stateDir, 'https://example.com/huge.bin', undefined)).rejects.toThrow(
        'byte file limit',
      )
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
