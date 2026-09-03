/**
 * Corpus check over the repo's `hypermedia/` folder (published to a Hypermedia
 * site from CI): every markdown file must be a fixed point of the converter
 * pair — export(import(export(md))) equals export(import(md)) with block ids
 * masked. Skipped when the corpus is not present (e.g. the published npm
 * package).
 */
import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs'
import {join, relative, resolve} from 'node:path'
import {describe, expect, it} from 'vitest'
import {blocksToMarkdown} from '../src/blocks-to-markdown'
import type {HMDocument} from '../src/hm-types'
import {markdownBlockNodesToHMBlockNodes, parseMarkdown} from '../src/markdown-to-blocks'

const CORPUS = resolve(__dirname, '../../../../hypermedia')

function toDoc(md: string): HMDocument {
  const {tree, metadata} = parseMarkdown(md)
  return {metadata, content: markdownBlockNodesToHMBlockNodes(tree)} as unknown as HMDocument
}

const maskIds = (s: string) => s.replace(/ ?<!-- (id|col|end):[^>]*-->/g, '')

function markdownFiles(dir: string): string[] {
  const out: string[] = []
  const walk = (d: string) => {
    for (const entry of readdirSync(d).sort()) {
      const full = join(d, entry)
      if (statSync(full).isDirectory()) {
        if (!entry.startsWith('.')) walk(full)
      } else if (entry.endsWith('.md')) out.push(relative(dir, full))
    }
  }
  walk(dir)
  return out
}

describe.skipIf(!existsSync(CORPUS))('hypermedia/ corpus round-trip', () => {
  const files = existsSync(CORPUS) ? markdownFiles(CORPUS) : []
  it.each(files)('%s is a fixed point', (file) => {
    const src = readFileSync(resolve(CORPUS, file), 'utf8')
    const once = blocksToMarkdown(toDoc(src), {ipfsGateway: false})
    const twice = blocksToMarkdown(toDoc(once), {ipfsGateway: false})
    expect(maskIds(twice)).toEqual(maskIds(once))
  })
})
