import {describe, expect, test} from 'bun:test'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  AgentMemoryError,
  MAX_MEMORY_FILE_BYTES,
  deleteMemoryPath,
  listMemory,
  memoryRootPath,
  readMemoryFile,
  resolveMemoryPath,
  writeMemoryFile,
} from '@/agent-memory'

function withStateDir(run: (stateDir: string) => void): void {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-memory-test-'))
  try {
    run(stateDir)
  } finally {
    fs.rmSync(stateDir, {recursive: true, force: true})
  }
}

describe('agent memory', () => {
  test('writes, lists, reads, and deletes files', () => {
    withStateDir((stateDir) => {
      const written = writeMemoryFile(stateDir, 'notes/todo.md', '# Todo\n\n- remember this\n')
      expect(written).toMatchObject({path: 'notes/todo.md', type: 'file'})
      writeMemoryFile(stateDir, 'MEMORY.md', 'index')

      const listed = listMemory(stateDir)
      expect(listed.entries.map((entry) => `${entry.type}:${entry.path}`)).toEqual([
        'file:MEMORY.md',
        'dir:notes',
        'file:notes/todo.md',
      ])
      expect(listed.totalBytes).toBeGreaterThan(0)

      const file = readMemoryFile(stateDir, 'notes/todo.md')
      expect(file.content).toBe('# Todo\n\n- remember this\n')

      expect(deleteMemoryPath(stateDir, 'notes')).toEqual({path: 'notes', deleted: true})
      expect(deleteMemoryPath(stateDir, 'notes')).toEqual({path: 'notes', deleted: false})
      expect(listMemory(stateDir).entries.map((entry) => entry.path)).toEqual(['MEMORY.md'])
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

  test('rejects oversized file writes and reads', () => {
    withStateDir((stateDir) => {
      expect(() => writeMemoryFile(stateDir, 'big.txt', 'x'.repeat(MAX_MEMORY_FILE_BYTES + 1))).toThrow('byte limit')
      fs.mkdirSync(memoryRootPath(stateDir), {recursive: true})
      fs.writeFileSync(path.join(memoryRootPath(stateDir), 'huge.txt'), 'x'.repeat(MAX_MEMORY_FILE_BYTES + 1))
      expect(() => readMemoryFile(stateDir, 'huge.txt')).toThrow('too large')
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
})
