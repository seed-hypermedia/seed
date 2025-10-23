import {describe, it, expect, vi} from 'vitest'
import {documentToText} from '../document-to-text'
import {hmId} from '../utils/entity-id-url'
import type {GRPCClient} from '..'

// Mock grpcClient
const createMockGrpcClient = (mockDocs: Record<string, any>) => {
  return {
    documents: {
      getDocument: vi.fn(async ({account, path}) => {
        // Normalize path by removing leading/trailing slashes and double slashes
        const normalizedPath = path
          ? path.replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/')
          : ''
        const key = `${account}${normalizedPath ? '/' + normalizedPath : ''}`
        const doc = mockDocs[key]
        if (!doc) {
          throw new Error(
            `Document not found: ${key} (available: ${Object.keys(
              mockDocs,
            ).join(', ')})`,
          )
        }
        return doc
      }),
    },
  } as unknown as GRPCClient
}

describe('documentToText', () => {
  it('converts simple paragraph to text', async () => {
    const mockDocs = {
      'test-account': {
        account: 'test-account',
        path: '',
        metadata: {name: 'Test Doc'},
        content: [
          {
            block: {
              id: 'block1',
              type: 'Paragraph',
              text: 'Hello world',
              annotations: [],
            },
            children: [],
          },
        ],
      },
    }

    const grpcClient = createMockGrpcClient(mockDocs)
    const id = hmId('test-account', {})

    const result = await documentToText({
      documentId: id,
      grpcClient,
      options: {},
    })

    expect(result).toBe('Hello world')
  })

  it('converts multiple paragraphs with proper spacing', async () => {
    const mockDocs = {
      'test-account': {
        account: 'test-account',
        path: '',
        metadata: {name: 'Test Doc'},
        content: [
          {
            block: {
              id: 'block1',
              type: 'Paragraph',
              text: 'First paragraph',
              annotations: [],
            },
            children: [],
          },
          {
            block: {
              id: 'block2',
              type: 'Paragraph',
              text: 'Second paragraph',
              annotations: [],
            },
            children: [],
          },
        ],
      },
    }

    const grpcClient = createMockGrpcClient(mockDocs)
    const id = hmId('test-account', {})

    const result = await documentToText({
      documentId: id,
      grpcClient,
      options: {},
    })

    expect(result).toBe('First paragraph\n\nSecond paragraph')
  })

  it('resolves inline embeds to document names', async () => {
    const mockDocs = {
      'test-account': {
        account: 'test-account',
        path: '',
        metadata: {name: 'Test Doc'},
        content: [
          {
            block: {
              id: 'block1',
              type: 'Paragraph',
              text: 'Check this \uFEFF out',
              annotations: [
                {
                  type: 'Embed',
                  link: 'hm://test-account/referenced-doc',
                  starts: [11],
                  ends: [12],
                },
              ],
            },
            children: [],
          },
        ],
      },
      'test-account/referenced-doc': {
        account: 'test-account',
        path: 'referenced-doc',
        metadata: {name: 'Referenced Document'},
        content: [],
      },
    }

    const grpcClient = createMockGrpcClient(mockDocs)
    const id = hmId('test-account', {})

    const result = await documentToText({
      documentId: id,
      grpcClient,
      options: {},
    })

    expect(result).toContain('[Referenced Document]')
  })

  it('processes embed blocks by including embedded document content', async () => {
    const mockDocs = {
      'test-account': {
        account: 'test-account',
        path: '',
        metadata: {name: 'Test Doc'},
        content: [
          {
            block: {
              id: 'block1',
              type: 'Paragraph',
              text: 'Before embed',
              annotations: [],
            },
            children: [],
          },
          {
            block: {
              id: 'block2',
              type: 'Embed',
              link: 'hm://test-account/embedded-doc',
            },
            children: [],
          },
        ],
      },
      'test-account/embedded-doc': {
        account: 'test-account',
        path: 'embedded-doc',
        metadata: {name: 'Embedded Document'},
        content: [
          {
            block: {
              id: 'embed-block1',
              type: 'Paragraph',
              text: 'Embedded content',
              annotations: [],
            },
            children: [],
          },
        ],
      },
    }

    const grpcClient = createMockGrpcClient(mockDocs)
    const id = hmId('test-account', {})

    const result = await documentToText({
      documentId: id,
      grpcClient,
      options: {},
    })

    expect(result).toBe('Before embed\n\nEmbedded content')
  })

  it('handles nested block structure', async () => {
    const mockDocs = {
      'test-account': {
        account: 'test-account',
        path: '',
        metadata: {name: 'Test Doc'},
        content: [
          {
            block: {
              id: 'block1',
              type: 'Paragraph',
              text: 'Parent block',
              annotations: [],
            },
            children: [
              {
                block: {
                  id: 'child1',
                  type: 'Paragraph',
                  text: 'Child block',
                  annotations: [],
                },
                children: [],
              },
            ],
          },
        ],
      },
    }

    const grpcClient = createMockGrpcClient(mockDocs)
    const id = hmId('test-account', {})

    const result = await documentToText({
      documentId: id,
      grpcClient,
      options: {},
    })

    expect(result).toBe('Parent block\n\nChild block')
  })

  it('prevents circular references', async () => {
    const mockDocs = {
      'test-account': {
        account: 'test-account',
        path: '',
        metadata: {name: 'Test Doc'},
        content: [
          {
            block: {
              id: 'block1',
              type: 'Embed',
              link: 'hm://test-account/doc-a',
            },
            children: [],
          },
        ],
      },
      'test-account/doc-a': {
        account: 'test-account',
        path: 'doc-a',
        metadata: {name: 'Doc A'},
        content: [
          {
            block: {
              id: 'block2',
              type: 'Embed',
              link: 'hm://test-account/',
            },
            children: [],
          },
        ],
      },
    }

    const grpcClient = createMockGrpcClient(mockDocs)
    const id = hmId('test-account', {})

    const result = await documentToText({
      documentId: id,
      grpcClient,
      options: {},
    })

    expect(result).toContain('[Circular Reference')
  })

  it('respects maxDepth option', async () => {
    const mockDocs = {
      'test-account': {
        account: 'test-account',
        path: '',
        metadata: {name: 'Test Doc'},
        content: [
          {
            block: {
              id: 'block1',
              type: 'Embed',
              link: 'hm://test-account/doc-a',
            },
            children: [],
          },
        ],
      },
      'test-account/doc-a': {
        account: 'test-account',
        path: 'doc-a',
        metadata: {name: 'Doc A'},
        content: [
          {
            block: {
              id: 'block2',
              type: 'Embed',
              link: 'hm://test-account/doc-b',
            },
            children: [],
          },
        ],
      },
      'test-account/doc-b': {
        account: 'test-account',
        path: 'doc-b',
        metadata: {name: 'Doc B'},
        content: [
          {
            block: {
              id: 'block3',
              type: 'Paragraph',
              text: 'Deep content',
              annotations: [],
            },
            children: [],
          },
        ],
      },
    }

    const grpcClient = createMockGrpcClient(mockDocs)
    const id = hmId('test-account', {})

    const result = await documentToText({
      documentId: id,
      grpcClient,
      options: {maxDepth: 1},
    })

    expect(result).toContain('[Max depth reached')
  })

  it('handles code blocks', async () => {
    const mockDocs = {
      'test-account': {
        account: 'test-account',
        path: '',
        metadata: {name: 'Test Doc'},
        content: [
          {
            block: {
              id: 'block1',
              type: 'Code',
              text: 'const x = 5;',
              annotations: [],
              attributes: {language: 'javascript'},
            },
            children: [],
          },
        ],
      },
    }

    const grpcClient = createMockGrpcClient(mockDocs)
    const id = hmId('test-account', {})

    const result = await documentToText({
      documentId: id,
      grpcClient,
      options: {},
    })

    expect(result).toBe('const x = 5;')
  })

  it('handles empty document', async () => {
    const mockDocs = {
      'test-account': {
        account: 'test-account',
        path: '',
        metadata: {name: 'Test Doc'},
        content: [],
      },
    }

    const grpcClient = createMockGrpcClient(mockDocs)
    const id = hmId('test-account', {})

    const result = await documentToText({
      documentId: id,
      grpcClient,
      options: {},
    })

    expect(result).toBe('')
  })

  it('skips query blocks', async () => {
    const mockDocs = {
      'test-account': {
        account: 'test-account',
        path: '',
        metadata: {name: 'Test Doc'},
        content: [
          {
            block: {
              id: 'block1',
              type: 'Paragraph',
              text: 'Before query',
              annotations: [],
            },
            children: [],
          },
          {
            block: {
              id: 'block2',
              type: 'Query',
              attributes: {query: {includes: []}},
            },
            children: [],
          },
          {
            block: {
              id: 'block3',
              type: 'Paragraph',
              text: 'After query',
              annotations: [],
            },
            children: [],
          },
        ],
      },
    }

    const grpcClient = createMockGrpcClient(mockDocs)
    const id = hmId('test-account', {})

    const result = await documentToText({
      documentId: id,
      grpcClient,
      options: {},
    })

    expect(result).toBe('Before query\n\nAfter query')
  })

  it('extracts text from heading blocks', async () => {
    const mockDocs = {
      'test-account': {
        account: 'test-account',
        path: '',
        metadata: {name: 'Test Doc'},
        content: [
          {
            block: {
              id: 'block1',
              type: 'Heading',
              text: 'This is a heading',
              annotations: [],
              attributes: {level: 1},
            },
            children: [],
          },
          {
            block: {
              id: 'block2',
              type: 'Paragraph',
              text: 'This is a paragraph',
              annotations: [],
            },
            children: [],
          },
        ],
      },
    }

    const grpcClient = createMockGrpcClient(mockDocs)
    const id = hmId('test-account', {})

    const result = await documentToText({
      documentId: id,
      grpcClient,
      options: {},
    })

    expect(result).toBe('This is a heading\n\nThis is a paragraph')
  })

  it('extracts text from button blocks using attributes.name', async () => {
    const mockDocs = {
      'test-account': {
        account: 'test-account',
        path: '',
        metadata: {name: 'Test Doc'},
        content: [
          {
            block: {
              id: 'block1',
              type: 'Button',
              attributes: {name: 'Click me'},
              link: 'https://example.com',
            },
            children: [],
          },
        ],
      },
    }

    const grpcClient = createMockGrpcClient(mockDocs)
    const id = hmId('test-account', {})

    const result = await documentToText({
      documentId: id,
      grpcClient,
      options: {},
    })

    expect(result).toBe('Click me')
  })

  it('extracts text from button blocks with fallback to text field', async () => {
    const mockDocs = {
      'test-account': {
        account: 'test-account',
        path: '',
        metadata: {name: 'Test Doc'},
        content: [
          {
            block: {
              id: 'block1',
              type: 'Button',
              text: 'Fallback text',
              link: 'https://example.com',
            },
            children: [],
          },
        ],
      },
    }

    const grpcClient = createMockGrpcClient(mockDocs)
    const id = hmId('test-account', {})

    const result = await documentToText({
      documentId: id,
      grpcClient,
      options: {},
    })

    expect(result).toBe('Fallback text')
  })

  it('respects lineBreaks: false option', async () => {
    const mockDocs = {
      'test-account': {
        account: 'test-account',
        path: '',
        metadata: {name: 'Test Doc'},
        content: [
          {
            block: {
              id: 'block1',
              type: 'Paragraph',
              text: 'First paragraph',
              annotations: [],
            },
            children: [],
          },
          {
            block: {
              id: 'block2',
              type: 'Paragraph',
              text: 'Second paragraph',
              annotations: [],
            },
            children: [],
          },
        ],
      },
    }

    const grpcClient = createMockGrpcClient(mockDocs)
    const id = hmId('test-account', {})

    const result = await documentToText({
      documentId: id,
      grpcClient,
      options: {lineBreaks: false},
    })

    expect(result).toBe('First paragraph Second paragraph')
  })

  it('includes line breaks by default (lineBreaks: true)', async () => {
    const mockDocs = {
      'test-account': {
        account: 'test-account',
        path: '',
        metadata: {name: 'Test Doc'},
        content: [
          {
            block: {
              id: 'block1',
              type: 'Paragraph',
              text: 'First paragraph',
              annotations: [],
            },
            children: [],
          },
          {
            block: {
              id: 'block2',
              type: 'Paragraph',
              text: 'Second paragraph',
              annotations: [],
            },
            children: [],
          },
        ],
      },
    }

    const grpcClient = createMockGrpcClient(mockDocs)
    const id = hmId('test-account', {})

    const result = await documentToText({
      documentId: id,
      grpcClient,
      options: {lineBreaks: true},
    })

    expect(result).toBe('First paragraph\n\nSecond paragraph')
  })

  it('handles embed with blockRef to return only specific block', async () => {
    const mockDocs = {
      'test-account': {
        account: 'test-account',
        path: '',
        metadata: {name: 'Test Doc'},
        content: [
          {
            block: {
              id: 'block1',
              type: 'Paragraph',
              text: 'Before embed',
              annotations: [],
            },
            children: [],
          },
          {
            block: {
              id: 'block2',
              type: 'Embed',
              link: 'hm://test-account/embedded-doc#targetbl',
            },
            children: [],
          },
        ],
      },
      'test-account/embedded-doc': {
        account: 'test-account',
        path: 'embedded-doc',
        metadata: {name: 'Embedded Document'},
        content: [
          {
            block: {
              id: 'not-target',
              type: 'Paragraph',
              text: 'This should not be included',
              annotations: [],
            },
            children: [],
          },
          {
            block: {
              id: 'targetbl',
              type: 'Paragraph',
              text: 'Only this block',
              annotations: [],
            },
            children: [],
          },
          {
            block: {
              id: 'also-not-target',
              type: 'Paragraph',
              text: 'This should also not be included',
              annotations: [],
            },
            children: [],
          },
        ],
      },
    }

    const grpcClient = createMockGrpcClient(mockDocs)
    const id = hmId('test-account', {})

    const result = await documentToText({
      documentId: id,
      grpcClient,
      options: {},
    })

    expect(result).toBe('Before embed\n\nOnly this block')
  })

  it('handles embed with blockRange to return only blocks in range', async () => {
    const mockDocs = {
      'test-account': {
        account: 'test-account',
        path: '',
        metadata: {name: 'Test Doc'},
        content: [
          {
            block: {
              id: 'block1',
              type: 'Embed',
              link: 'hm://test-account/embedded-doc#block0id[1:2]',
            },
            children: [],
          },
        ],
      },
      'test-account/embedded-doc': {
        account: 'test-account',
        path: 'embedded-doc',
        metadata: {name: 'Embedded Document'},
        content: [
          {
            block: {
              id: 'block0id',
              type: 'Paragraph',
              text: 'Parent block',
              annotations: [],
            },
            children: [
              {
                block: {
                  id: 'child0',
                  type: 'Paragraph',
                  text: 'Child 0 - not included',
                  annotations: [],
                },
                children: [],
              },
              {
                block: {
                  id: 'child1',
                  type: 'Paragraph',
                  text: 'Block 1 - included',
                  annotations: [],
                },
                children: [],
              },
              {
                block: {
                  id: 'child2',
                  type: 'Paragraph',
                  text: 'Block 2 - included',
                  annotations: [],
                },
                children: [],
              },
              {
                block: {
                  id: 'child3',
                  type: 'Paragraph',
                  text: 'Child 3 - not included',
                  annotations: [],
                },
                children: [],
              },
            ],
          },
        ],
      },
    }

    const grpcClient = createMockGrpcClient(mockDocs)
    const id = hmId('test-account', {})

    const result = await documentToText({
      documentId: id,
      grpcClient,
      options: {},
    })

    expect(result).toBe('Block 1 - included\n\nBlock 2 - included')
  })
})
