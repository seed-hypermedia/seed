import {describe, expect, it, vi} from 'vitest'
import {
  commentToResolvedMarkdown,
  contentToResolvedMarkdown,
  documentToResolvedMarkdown,
} from '../src/blocks-to-markdown'

function doc(name: string, content: any[], version = 'latest-version') {
  return {metadata: {name}, content, version, authors: []} as any
}

function paragraph(id: string, text: string, annotations?: any[]) {
  return {block: {type: 'Paragraph', id, text, annotations, attributes: {}}, children: []} as any
}

function embed(id: string, link: string) {
  return {block: {type: 'Embed', id, link, attributes: {}}, children: []} as any
}

function query(id: string, attributes: Record<string, unknown>) {
  return {block: {type: 'Query', id, attributes}, children: []} as any
}

function client(responses: Record<string, unknown>) {
  return {
    request: vi.fn(async (key: string, input: any) => {
      if (key === 'Query') {
        const lookup = `Query:${JSON.stringify(input)}`
        if (!(lookup in responses)) throw new Error(`No response for ${lookup}`)
        return responses[lookup]
      }
      const packed =
        typeof input === 'string'
          ? `hm://${input}`
          : input?.path?.length
          ? `hm://${input.uid}/${input.path.join('/')}`
          : `hm://${input.uid}`
      const version = typeof input === 'string' ? '' : input?.version ? `?v=${input.version}` : ''
      const lookup = `${key}:${packed}${version}`
      if (!(lookup in responses)) throw new Error(`No response for ${lookup}`)
      return responses[lookup]
    }),
  } as any
}

describe('resolved markdown', () => {
  it('renders :profile inline embeds with account display names', async () => {
    const c = client({
      'Account:hm://alice': {type: 'account', id: {uid: 'alice'}, metadata: {name: 'Alice Example'}},
    })
    const markdown = await documentToResolvedMarkdown(
      doc('Root', [paragraph('p1', 'hello ￼', [{type: 'Embed', starts: [6], ends: [7], link: 'hm://alice/:profile'}])]),
      {client: c},
    )

    expect(markdown).toContain('hello [@Alice Example](hm://alice/:profile)')
    expect(c.request).toHaveBeenCalledWith('Account', 'alice')
  })

  it('renders site-scoped :profile inline embeds with the referenced account display name', async () => {
    const c = client({
      'Account:hm://alice': {type: 'account', id: {uid: 'alice'}, metadata: {name: 'Alice Example'}},
    })
    const markdown = await documentToResolvedMarkdown(
      doc('Root', [
        paragraph('p1', 'hello ￼', [{type: 'Embed', starts: [6], ends: [7], link: 'hm://site/:profile/alice'}]),
      ]),
      {client: c},
    )

    expect(markdown).toContain('hello [@Alice Example](hm://site/:profile/alice)')
    expect(c.request).toHaveBeenCalledWith('Account', 'alice')
  })

  it('renders document inline embeds with document names', async () => {
    const c = client({
      'Resource:hm://site/docs': {type: 'document', document: doc('Named Document', [])},
    })
    const markdown = await documentToResolvedMarkdown(
      doc('Root', [paragraph('p1', 'see ￼', [{type: 'Embed', starts: [4], ends: [5], link: 'hm://site/docs'}])]),
      {client: c},
    )

    expect(markdown).toContain('see [Named Document](hm://site/docs)')
  })

  it('inlines block embeds as resolved markdown content', async () => {
    const c = client({
      'Resource:hm://site/embedded': {
        type: 'document',
        document: doc('Embedded Doc', [paragraph('e1', 'embedded body')]),
      },
    })
    const markdown = await documentToResolvedMarkdown(doc('Root', [embed('emb1', 'hm://site/embedded')]), {client: c})

    expect(markdown).toContain('<!-- embed: hm://site/embedded; title: Embedded Doc -->')
    expect(markdown).toContain('embedded body')
    expect(markdown).toContain('<!-- /embed: hm://site/embedded -->')
    expect(markdown).not.toContain('> embedded body')
  })

  it('zooms block embeds to the referenced text range', async () => {
    const c = client({
      'Resource:hm://site/embedded': {
        type: 'document',
        document: doc('Embedded Doc', [paragraph('target', 'hello selected world')]),
      },
    })
    const markdown = await documentToResolvedMarkdown(doc('Root', [embed('emb1', 'hm://site/embedded#target[6:14]')]), {
      client: c,
    })

    expect(markdown).toContain('block: target[6:14]')
    expect(markdown).toContain('selected')
    expect(markdown).not.toContain('hello selected world')
  })

  it('inlines embedded comments and names the comment author', async () => {
    const c = client({
      'Resource:hm://author/comment1': {
        type: 'comment',
        comment: {
          id: 'author/comment1',
          author: 'author',
          version: 'comment-version',
          content: [paragraph('c1', 'comment body')],
        },
      },
      'Account:hm://author': {type: 'account', id: {uid: 'author'}, metadata: {name: 'Comment Author'}},
    })
    const markdown = await documentToResolvedMarkdown(doc('Root', [embed('emb1', 'hm://author/comment1')]), {client: c})

    expect(markdown).toContain('<!-- embed: hm://author/comment1; title: Comment by Comment Author -->')
    expect(markdown).toContain('comment body')
  })

  it('shows when an embed references a specific older version', async () => {
    const c = client({
      'Resource:hm://site/embedded?v=old-version': {
        type: 'document',
        document: doc('Embedded Doc', [paragraph('e1', 'old body')], 'current-version'),
      },
    })
    const markdown = await documentToResolvedMarkdown(
      doc('Root', [embed('emb1', 'hm://site/embedded?v=old-version')]),
      {
        client: c,
      },
    )

    expect(markdown).toContain('version: old-version')
    expect(markdown).not.toContain('latest is')
  })

  it('block embeds prefer root document content over account profile metadata', async () => {
    const c = client({
      'Account:hm://site': {type: 'account', id: {uid: 'site'}, metadata: {name: 'Site Account'}},
      'Resource:hm://site': {
        type: 'document',
        document: doc('Home Document', [paragraph('home', 'home body')]),
      },
    })
    const markdown = await documentToResolvedMarkdown(doc('Root', [embed('emb1', 'hm://site')]), {client: c})

    expect(markdown).toContain('<!-- embed: hm://site; title: Home Document -->')
    expect(markdown).toContain('home body')
    expect(c.request).not.toHaveBeenCalledWith('Account', 'site')
  })

  it('resolves query blocks in shared resolved markdown', async () => {
    const c = client({
      'Query:{"includes":[{"space":"site","path":"/","mode":"Children"}],"sort":[{"term":"UpdateTime","reverse":true}],"limit":5}':
        {
          results: [{id: {id: 'hm://site/result', uid: 'site', path: ['result']}, metadata: {name: 'Query Result'}}],
        },
    })
    const markdown = await documentToResolvedMarkdown(
      doc('Root', [query('q1', {space: 'site', path: '/', mode: 'Children', limit: 5})]),
      {client: c},
    )

    expect(c.request).toHaveBeenCalledWith('Query', {
      includes: [{space: 'site', path: '/', mode: 'Children'}],
      sort: [{term: 'UpdateTime', reverse: true}],
      limit: 5,
    })
    expect(markdown).toContain('- [Query Result](hm://site/result)')
  })

  it('resolves block embeds while rendering standalone block content', async () => {
    const c = client({
      'Resource:hm://site/embedded': {
        type: 'document',
        document: doc('Embedded Doc', [paragraph('e1', 'standalone embedded body')]),
      },
    })
    const markdown = await contentToResolvedMarkdown([embed('emb1', 'hm://site/embedded')], {client: c})

    expect(markdown).toContain('standalone embedded body')
    expect(markdown).toContain('<!-- /embed: hm://site/embedded -->')
    expect(markdown).not.toContain('> standalone embedded body')
  })

  it('resolves embeds while rendering comments directly', async () => {
    const c = client({
      'Account:hm://alice': {type: 'account', id: {uid: 'alice'}, metadata: {name: 'Alice Example'}},
    })
    const markdown = await commentToResolvedMarkdown(
      {
        id: 'author/comment1',
        author: 'author',
        version: 'v1',
        content: [paragraph('c1', 'hi ￼', [{type: 'Embed', starts: [3], ends: [4], link: 'hm://alice/:profile'}])],
      } as any,
      {client: c},
    )

    expect(markdown).toContain('hi [@Alice Example](hm://alice/:profile)')
  })
})
