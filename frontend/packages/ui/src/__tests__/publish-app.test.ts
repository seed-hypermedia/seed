import {fileToIpfsBlobs} from '@seed-hypermedia/client'
import {encodeDagCbor} from '@seed-hypermedia/client/signed-blob'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {describe, expect, it, vi} from 'vitest'
import {APP_TOOL_TYPE, APP_TYPE} from '../agents/apps'
import {authoredLambdas, descriptionParagraphs, planAppFromTools, preparePublishedApp} from '../agents/publish-app'

vi.mock('../agents/mount', () => ({
  signDocumentAttributes: vi.fn(async ({to, paragraphs}: {to: {id: string}; paragraphs: unknown[]}) => ({
    id: to.id,
    blobs: [{cid: `cid-of-${to.id}`, data: new Uint8Array([paragraphs.length])}],
  })),
}))

const convert = {
  name: 'convert',
  kind: 'lambda' as const,
  summary: 'Converts PDFs.',
  description: 'Converts PDFs to markdown.\n\nPass memory paths in `files`.',
  input: {type: 'object', properties: {files: {type: 'array'}}},
  output: {type: 'object'},
  source: 'export default async (input) => input',
  runtime: 'typescript' as const,
  cid: 'c1',
  enabled: true,
  granted: true,
  createdAt: 0,
  updatedAt: 0,
}

describe('Publish as app', () => {
  it("offers only the agent's own lambdas: not builtins, not the tools of installed apps", () => {
    const tools = [
      convert,
      {...convert, name: 'search', kind: 'builtin' as const},
      {...convert, name: 'projected', app: {slug: 'other', scope: 'space' as const}, source: undefined},
    ]
    expect(authoredLambdas(tools).map((tool) => tool.name)).toEqual(['convert'])
    expect(authoredLambdas(undefined)).toEqual([])
  })

  it('splits a description into paragraphs with stable ids', () => {
    expect(descriptionParagraphs('One.\n\nTwo.\n', 'p-')).toEqual([
      {id: 'p-1', text: 'One.'},
      {id: 'p-2', text: 'Two.'},
    ])
  })

  it('plans the app in the copy form with one tool page per lambda, its contract and code as blobs', async () => {
    const parent = hmId('alice')
    const plan = await planAppFromTools(parent, {name: 'Converter', slug: 'converter', summary: 'Converts.'}, [
      convert,
      {...convert, name: 'count', runtime: 'python', output: undefined, source: 'def main(input, ctx): return 1'},
    ])
    expect(plan.pages.map((page) => page.id.id)).toEqual([
      'hm://alice/converter',
      'hm://alice/converter/tools',
      'hm://alice/converter/tools/convert',
      'hm://alice/converter/tools/count',
    ])
    expect(plan.pages[0]!.attrs).toContainEqual({key: ['attributesSchema'], value: APP_TYPE})
    expect(plan.pages[0]!.attrs).toContainEqual({key: ['install', 'scope'], value: 'space'})
    expect(plan.pages[1]!.attrs).toContainEqual({key: ['childAttributesSchema'], value: APP_TOOL_TYPE})
    const code = await fileToIpfsBlobs(new TextEncoder().encode(convert.source))
    const input = await encodeDagCbor(convert.input)
    const output = await encodeDagCbor(convert.output)
    const page = plan.pages[2]!
    expect(page.attrs).toEqual([
      {key: ['name'], value: 'convert'},
      {key: ['summary'], value: 'Converts PDFs.'},
      {key: ['attributesSchema'], value: APP_TOOL_TYPE},
      {key: ['tool'], value: 'convert'},
      {key: ['runtime'], value: 'ts'},
      {key: ['inputSchema'], value: `ipfs://${input.cid}`},
      {key: ['outputSchema'], value: `ipfs://${output.cid}`},
      {key: ['code'], value: `ipfs://${code.cid}`},
    ])
    expect(page.paragraphs.map((p) => p.text)).toEqual(['Converts PDFs to markdown.', 'Pass memory paths in `files`.'])
    expect(plan.pages[3]!.attrs).toContainEqual({key: ['runtime'], value: 'python'})
    expect(plan.pages[3]!.attrs.some((attr) => attr.key[0] === 'outputSchema')).toBe(false)
    // Every content blob rides along: the code block of each tool and each contract object.
    const cids = plan.blobs.map((blob) => blob.cid)
    expect(cids).toContain(code.cid)
    expect(cids).toContain(input.cid)
    expect(cids).toContain(output.cid)
  })

  it('signs the pages parents first', async () => {
    const plan = await planAppFromTools(hmId('alice'), {name: 'C', slug: 'c', summary: 'S'}, [convert])
    const pages = await preparePublishedApp({client: {} as never, accountUid: 'alice', plan})
    expect(pages.map((page) => page.id)).toEqual(['hm://alice/c', 'hm://alice/c/tools', 'hm://alice/c/tools/convert'])
  })
})
