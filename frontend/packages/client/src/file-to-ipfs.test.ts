import {describe, expect, it} from 'vitest'
import {CID} from 'multiformats/cid'
import {directoryToIpfsBlobs, fileToIpfsBlobs, normalizeDirectoryFilePath} from './file-to-ipfs'

const text = (value: string) => new TextEncoder().encode(value)

describe('directoryToIpfsBlobs', () => {
  it('builds a dag-pb folder whose root links every file and nested folder', async () => {
    const {cid, blobs} = await directoryToIpfsBlobs([
      {path: 'index.html', content: text('<h1>App</h1>')},
      {path: 'assets/app.js', content: text('console.log(1)')},
    ])
    const root = CID.parse(cid)
    expect(root.code).toBe(0x70) // dag-pb: a UnixFS directory, not a raw leaf
    const cids = new Set(blobs.map((blob) => blob.cid))
    expect(cids.has(cid)).toBe(true)
    // The files are published as UnixFS files, identical to a standalone upload.
    const index = await fileToIpfsBlobs(text('<h1>App</h1>'))
    expect(cids.has(index.cid)).toBe(true)
    // root + assets dir + 2 files
    expect(blobs.length).toBe(4)
  })

  it('is deterministic for the same files in any order', async () => {
    const a = await directoryToIpfsBlobs([
      {path: 'index.html', content: text('a')},
      {path: 'b.js', content: text('b')},
    ])
    const b = await directoryToIpfsBlobs([
      {path: 'b.js', content: text('b')},
      {path: 'index.html', content: text('a')},
    ])
    expect(a.cid).toBe(b.cid)
  })

  it('rejects empty folders, duplicate names and paths that climb out', async () => {
    await expect(directoryToIpfsBlobs([])).rejects.toThrow()
    await expect(
      directoryToIpfsBlobs([
        {path: 'a.js', content: text('1')},
        {path: './a.js', content: text('2')},
      ]),
    ).rejects.toThrow(/Duplicate/)
    await expect(directoryToIpfsBlobs([{path: '../index.html', content: text('x')}])).rejects.toThrow(/Invalid/)
  })
})

describe('normalizeDirectoryFilePath', () => {
  it('strips leading slashes and empty segments and keeps nesting', () => {
    expect(normalizeDirectoryFilePath('/a//b/c.txt')).toBe('a/b/c.txt')
    expect(normalizeDirectoryFilePath('a\\b.txt')).toBe('a/b.txt')
    expect(() => normalizeDirectoryFilePath('')).toThrow()
    expect(() => normalizeDirectoryFilePath('a/../b')).toThrow()
  })
})
