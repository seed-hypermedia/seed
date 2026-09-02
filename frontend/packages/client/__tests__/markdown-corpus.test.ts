/**
 * Corpus check: every markdown document in the repo's `hypermedia/` library
 * must be a fixed point of the converter pair — export(import(export(md)))
 * equals export(import(md)) with block ids masked. Skipped when the corpus
 * is not present (e.g. the published npm package).
 */
import {existsSync, readdirSync, readFileSync} from 'node:fs'
import {resolve} from 'node:path'
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

describe.skipIf(!existsSync(CORPUS))('hypermedia/ corpus round-trip', () => {
  const files = existsSync(CORPUS) ? readdirSync(CORPUS).filter((f) => f.endsWith('.md')) : []
  it.each(files)('%s is a fixed point', (file) => {
    const src = readFileSync(resolve(CORPUS, file), 'utf8')
    const once = blocksToMarkdown(toDoc(src), {ipfsGateway: false})
    const twice = blocksToMarkdown(toDoc(once), {ipfsGateway: false})
    expect(maskIds(twice)).toEqual(maskIds(once))
  })
})
