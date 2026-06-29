import {
  EditorBlock,
  EditorCodeBlock,
  EditorEmbedBlock,
  EditorFileBlock,
  EditorHeadingBlock,
  EditorImageBlock,
  EditorMathBlock,
  EditorQueryBlock,
  EditorVideoBlock,
  EditorWebEmbedBlock,
} from '@seed-hypermedia/client/editor-types'
import {editorBlockToHMBlock, editorBlocksToHMBlockNodes} from '@seed-hypermedia/client/editorblock-to-hmblock'
import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import {
  HMBlock,
  HMBlockCode,
  HMBlockEmbed,
  HMBlockHeading,
  HMBlockImage,
  HMBlockMath,
  HMBlockQuery,
  HMBlockWebEmbed,
} from '@seed-hypermedia/client/hm-types'
import {hmBlocksToEditorContent} from '@seed-hypermedia/client/hmblock-to-editorblock'
import {describe, expect, test, vi} from 'vitest'

describe('EditorBlock to HMBlock', () => {
  describe('blockTypes', () => {
    test('paragraph', () => {
      const editorBlock: EditorBlock = {
        id: 'foo',
        type: 'paragraph',
        children: [],
        props: {},
        content: [
          {
            type: 'text',
            text: 'Hello world',
            styles: {},
          },
        ],
      }

      const result: HMBlock = {
        id: 'foo',
        type: 'Paragraph',
        text: 'Hello world',
        annotations: [],
        attributes: {},
      }
      const val = editorBlockToHMBlock(editorBlock)

      expect(val).toEqual(result)
    })

    test('paragraph replaces reserved empty fallback id', () => {
      const editorBlock: EditorBlock = {
        id: 'empty',
        type: 'paragraph',
        children: [],
        props: {},
        content: [
          {
            type: 'text',
            text: 'Hello world',
            styles: {},
          },
        ],
      }

      const val = editorBlockToHMBlock(editorBlock)

      expect(val.id).not.toBe('empty')
      expect(val.id).toHaveLength(8)
      expect(val).toMatchObject({
        type: 'Paragraph',
        text: 'Hello world',
        annotations: [],
        attributes: {},
      })
    })

    test('paragraph with styles formats', () => {
      const editorBlock: EditorBlock = {
        id: 'foo',
        type: 'paragraph',
        children: [],
        props: {},
        content: [
          {text: 'A', type: 'text', styles: {bold: true}},
          {text: 'B', type: 'text', styles: {italic: true}},
          {text: 'C', type: 'text', styles: {underline: true}},
          {text: 'D', type: 'text', styles: {strike: true}},
          {text: 'E', type: 'text', styles: {code: true}},
        ],
      }

      const result: HMBlock = {
        id: 'foo',
        type: 'Paragraph',
        text: 'ABCDE',
        annotations: [
          {type: 'Bold', attributes: {}, link: '', starts: [0], ends: [1]},
          {type: 'Italic', attributes: {}, link: '', starts: [1], ends: [2]},
          {type: 'Underline', attributes: {}, link: '', starts: [2], ends: [3]},
          {type: 'Strike', attributes: {}, link: '', starts: [3], ends: [4]},
          {type: 'Code', attributes: {}, link: '', starts: [4], ends: [5]},
        ],
        attributes: {},
      }
      const val = editorBlockToHMBlock(editorBlock)

      expect(val).toEqual(result)
    })

    test('paragraph with overlapping styles formats', () => {
      const editorBlock: EditorBlock = {
        id: 'foo',
        type: 'paragraph',
        children: [],
        props: {},
        content: [
          {text: 'A', type: 'text', styles: {}},
          {text: 'B', type: 'text', styles: {bold: true}},
          {text: 'C', type: 'text', styles: {bold: true, italic: true}},
          {text: 'D', type: 'text', styles: {italic: true}},
          {text: 'E', type: 'text', styles: {}},
        ],
      }

      const result: HMBlock = {
        id: 'foo',
        type: 'Paragraph',
        text: 'ABCDE',
        annotations: [
          {type: 'Bold', attributes: {}, link: '', starts: [1], ends: [3]},
          {type: 'Italic', attributes: {}, link: '', starts: [2], ends: [4]},
        ],
        attributes: {},
      }
      const val = editorBlockToHMBlock(editorBlock)

      expect(val).toEqual(result)
    })

    test('paragraph with emojis and format', () => {
      const editorBlock: EditorBlock = {
        id: 'foo',
        type: 'paragraph',
        children: [],
        props: {},
        content: [
          {
            type: 'text',
            text: '👨‍👩‍👧‍👦 Hello ',
            styles: {},
          },
          {
            type: 'text',
            text: 'world!',
            styles: {
              bold: true,
            },
          },
        ],
      }

      const result: HMBlock = {
        id: 'foo',
        type: 'Paragraph',
        text: '👨‍👩‍👧‍👦 Hello world!',
        annotations: [
          {
            type: 'Bold',
            attributes: {},
            link: '',
            starts: [14],
            ends: [20],
          },
        ],
        attributes: {},
      }
      const val = editorBlockToHMBlock(editorBlock)

      expect(val).toEqual(result)
    })

    test('paragraph with link', () => {
      const editorBlock: EditorBlock = {
        id: 'foo',
        type: 'paragraph',
        children: [],
        props: {},
        content: [
          {
            type: 'text',
            text: 'Hello ',
            styles: {},
          },
          {
            type: 'link',
            href: 'https://example.com',
            content: [
              {
                type: 'text',
                text: 'world',
                styles: {},
              },
            ],
          },
        ],
      }

      const result: HMBlock = {
        id: 'foo',
        type: 'Paragraph',
        text: 'Hello world',
        annotations: [
          {
            type: 'Link',
            attributes: {},

            starts: [6],
            ends: [11],
            link: 'https://example.com',
          },
        ],
        attributes: {},
      }
      const val = editorBlockToHMBlock(editorBlock)

      expect(val).toEqual(result)
    })

    test('paragraph with link and more content', () => {
      const editorBlock: EditorBlock = {
        id: 'foo',
        type: 'paragraph',
        children: [],
        props: {},
        content: [
          {
            type: 'text',
            text: 'Hello ',
            styles: {},
          },
          {
            type: 'link',
            href: 'https://example.com',
            content: [
              {
                type: 'text',
                text: 'world',
                styles: {},
              },
            ],
          },
          {
            type: 'text',
            text: ' and all of ',
            styles: {},
          },
          {
            text: 'you!',
            type: 'text',
            styles: {bold: true},
          },
        ],
      }

      const result: HMBlock = {
        id: 'foo',
        type: 'Paragraph',
        text: 'Hello world and all of you!',
        annotations: [
          {
            type: 'Link',
            starts: [6],
            ends: [11],
            link: 'https://example.com',
            attributes: {},
          },
          {
            type: 'Bold',
            starts: [23],
            ends: [27],
            attributes: {},
            link: '',
          },
        ],
        attributes: {},
      }
      const val = editorBlockToHMBlock(editorBlock)
      expect(val).toEqual(result)
    })

    test('paragraph with inline embed', () => {
      const editorBlock: EditorBlock = {
        id: 'foo',
        type: 'paragraph',
        children: [],
        props: {},
        content: [
          {
            type: 'text',
            text: 'Hello ',
            styles: {},
          },
          {
            type: 'inline-embed',
            link: 'hm://asdf1234',
            styles: {},
          },
        ],
      }

      const result: HMBlock = {
        id: 'foo',
        type: 'Paragraph',
        text: 'Hello \uFFFC',
        annotations: [
          {
            type: 'Embed',
            attributes: {},
            starts: [6],
            ends: [7],
            link: 'hm://asdf1234',
          },
        ],
        attributes: {},
      }
      const val = editorBlockToHMBlock(editorBlock)

      expect(val).toEqual(result)
    })

    test('paragraph with inline embed and formatting', () => {
      const editorBlock: EditorBlock = {
        id: 'foo',
        type: 'paragraph',
        children: [],
        props: {},
        content: [
          {
            type: 'text',
            text: 'Hello ',
            styles: {},
          },
          {
            type: 'inline-embed',
            link: 'hm://asdf1234',
            styles: {},
          },
          {
            type: 'text',
            text: ' ',
            styles: {},
          },
          {
            type: 'text',
            text: 'how are',
            styles: {
              italic: true,
            },
          },
          {
            type: 'text',
            text: ' ',
            styles: {},
          },
          {
            type: 'text',
            text: 'you?',
            styles: {
              bold: true,
            },
          },
        ],
      }

      const result: HMBlock = {
        id: 'foo',
        type: 'Paragraph',
        text: 'Hello \uFFFC how are you?',
        annotations: [
          {
            type: 'Embed',
            attributes: {},
            starts: [6],
            ends: [7],
            link: 'hm://asdf1234',
          },
          {
            type: 'Italic',
            attributes: {},
            link: '',
            starts: [8],
            ends: [15],
          },
          {
            type: 'Bold',
            attributes: {},
            link: '',
            starts: [16],
            ends: [20],
          },
        ],
        attributes: {},
      }
      const val = editorBlockToHMBlock(editorBlock)

      expect(val).toEqual(result)
    })

    test('heading', () => {
      const editorBlock: EditorHeadingBlock = {
        id: 'foo',
        type: 'heading',
        children: [],
        props: {},
        content: [
          {
            type: 'text',
            text: 'Hello world',
            styles: {},
          },
        ],
      }

      const result: HMBlockHeading = {
        id: 'foo',
        type: 'Heading',
        text: 'Hello world',
        annotations: [],
        attributes: {},
      }
      const val = editorBlockToHMBlock(editorBlock)

      expect(val).toEqual(result)
    })

    test('code-block', () => {
      const editorBlock: EditorCodeBlock = {
        id: 'foo',
        type: 'code-block',
        children: [],
        props: {
          language: 'javascript',
        },
        content: [
          {
            type: 'text',
            text: `const hello = 'world'`,
            styles: {},
          },
        ],
      }

      const result: HMBlockCode = {
        id: 'foo',
        type: 'Code',
        text: `const hello = 'world'`,
        annotations: [],
        attributes: {
          language: 'javascript',
        },
      }
      const val = editorBlockToHMBlock(editorBlock)

      expect(val).toEqual(result)
    })

    test('math', () => {
      const editorBlock: EditorMathBlock = {
        id: 'foo',
        type: 'math',
        children: [],
        props: {},
        content: [
          {
            type: 'text',
            text: `MATH HERE`,
            styles: {},
          },
        ],
      }

      const result: HMBlockMath = {
        id: 'foo',
        type: 'Math',
        text: `MATH HERE`,
        annotations: [],
        attributes: {},
      }
      const val = editorBlockToHMBlock(editorBlock)

      expect(val).toEqual(result)
    })

    test('image', () => {
      const editorBlock: EditorImageBlock = {
        id: 'foo',
        type: 'image',
        children: [],
        props: {
          url: 'ipfs://foobarcid_IMAGE',
          width: '400',
        },
        content: [
          {
            type: 'text',
            text: '',
            styles: {},
          },
        ],
      }

      const result: HMBlockImage = {
        id: 'foo',
        type: 'Image',
        text: ``,
        link: 'ipfs://foobarcid_IMAGE',
        annotations: [],
        attributes: {
          width: 400,
        },
      }
      const val = editorBlockToHMBlock(editorBlock)

      expect(val).toEqual(result)
    })

    test('image removing width', () => {
      const editorBlock: EditorImageBlock = {
        id: 'foo',
        type: 'image',
        children: [],
        props: {
          url: 'ipfs://foobarcid_IMAGE',
          width: '400',
        },
        content: [
          {
            type: 'text',
            text: '',
            styles: {},
          },
        ],
      }

      const result: HMBlockImage = {
        id: 'foo',
        type: 'Image',
        text: ``,
        link: 'ipfs://foobarcid_IMAGE',
        annotations: [],
        attributes: {
          width: 400,
        },
      }
      const val = editorBlockToHMBlock(editorBlock)

      expect(val).toEqual(result)
    })

    test('image percentage width is preserved as a responsive width value', () => {
      const editorBlock: EditorImageBlock = {
        id: 'foo',
        type: 'image',
        children: [],
        props: {
          url: 'ipfs://foobarcid_IMAGE',
          width: '80%',
        },
        content: [
          {
            type: 'text',
            text: '',
            styles: {},
          },
        ],
      }

      const result: HMBlockImage = {
        id: 'foo',
        type: 'Image',
        text: ``,
        link: 'ipfs://foobarcid_IMAGE',
        annotations: [],
        attributes: {
          width: 80,
        },
      }
      const val = editorBlockToHMBlock(editorBlock)

      expect(val).toEqual(result)
    })

    test('video', () => {
      const editorBlock: EditorVideoBlock = {
        id: 'foo',
        type: 'video',
        children: [],
        props: {
          url: 'ipfs://foobarcid_VIDEO',
          width: '240',
          name: 'test demo video',
        },
        content: [
          {
            type: 'text',
            text: '',
            styles: {},
          },
        ],
      }

      const result: HMBlock = {
        id: 'foo',
        type: 'Video',
        text: ``,
        link: 'ipfs://foobarcid_VIDEO',
        annotations: [],
        attributes: {
          width: 240,
          name: 'test demo video',
        },
      }
      const val = editorBlockToHMBlock(editorBlock)

      expect(val).toEqual(result)
    })

    test('video with autoplay, loop, and muted attributes', () => {
      const editorBlock: EditorVideoBlock = {
        id: 'foo',
        type: 'video',
        children: [],
        props: {
          url: 'ipfs://foobarcid_VIDEO',
          width: '240',
          name: 'test demo video',
          autoplay: 'true',
          loop: 'true',
          muted: 'true',
        },
        content: [
          {
            type: 'text',
            text: '',
            styles: {},
          },
        ],
      }

      const result: HMBlock = {
        id: 'foo',
        type: 'Video',
        text: ``,
        link: 'ipfs://foobarcid_VIDEO',
        annotations: [],
        attributes: {
          width: 240,
          name: 'test demo video',
          autoplay: true,
          loop: true,
          muted: true,
        },
      }
      const val = editorBlockToHMBlock(editorBlock)

      expect(val).toEqual(result)
    })

    test('video with default values does not write optional attributes', () => {
      const editorBlock: EditorVideoBlock = {
        id: 'foo',
        type: 'video',
        children: [],
        props: {
          url: 'ipfs://foobarcid_VIDEO',
          width: '240',
          name: 'test demo video',
          autoplay: 'false',
          loop: 'false',
          muted: 'false',
        },
        content: [
          {
            type: 'text',
            text: '',
            styles: {},
          },
        ],
      }

      const result: HMBlock = {
        id: 'foo',
        type: 'Video',
        text: ``,
        link: 'ipfs://foobarcid_VIDEO',
        annotations: [],
        attributes: {
          width: 240,
          name: 'test demo video',
        },
      }
      const val = editorBlockToHMBlock(editorBlock)

      expect(val).toEqual(result)
    })

    test('file', () => {
      const editorBlock: EditorFileBlock = {
        id: 'foo',
        type: 'file',
        children: [],
        props: {
          url: 'ipfs://foobarcid_FILE',
          name: 'testfile.pdf',
          size: '123456',
        },
        content: [
          {
            type: 'text',
            text: '',
            styles: {},
          },
        ],
      }

      const result: HMBlock = {
        id: 'foo',
        type: 'File',
        text: ``,
        link: 'ipfs://foobarcid_FILE',
        annotations: [],
        attributes: {
          name: 'testfile.pdf',
          size: 123456,
        },
      }

      const val = editorBlockToHMBlock(editorBlock)

      expect(val).toEqual(result)
    })

    test('embed', () => {
      const editorBlock: EditorEmbedBlock = {
        id: 'foo',
        type: 'embed',
        children: [],
        props: {
          url: 'hm://foobarembed',
          view: 'Card',
        },
        content: [
          {
            type: 'text',
            text: '',
            styles: {},
          },
        ],
      }

      const result: HMBlockEmbed = {
        id: 'foo',
        type: 'Embed',
        text: ``,
        link: 'hm://foobarembed',
        annotations: [],
        attributes: {
          view: 'Card',
        },
      }

      const val = editorBlockToHMBlock(editorBlock)

      expect(val).toEqual(result)
    })

    test('web embed', () => {
      const editorBlock: EditorWebEmbedBlock = {
        id: 'foo',
        type: 'web-embed',
        children: [],
        props: {
          url: 'hm://foobarwebembed',
        },
        content: [
          {
            type: 'text',
            text: '',
            styles: {},
          },
        ],
      }

      const result: HMBlockWebEmbed = {
        id: 'foo',
        type: 'WebEmbed',
        text: ``,
        link: 'hm://foobarwebembed',
        annotations: [],
        attributes: {},
      }

      const val = editorBlockToHMBlock(editorBlock)

      expect(val).toEqual(result)
    })

    test('query block', () => {
      const editorBlock: EditorQueryBlock = {
        id: 'foo',
        type: 'query',
        children: [],
        content: [
          {
            type: 'text',
            text: '',
            styles: {},
          },
        ],
        props: {
          banner: 'true',
          queryIncludes: '[{"space": "FOO_SPACE", "path": "", "mode": "Children"}]',
          querySort: '[{"term": "UpdateTime", "reverse": false}]',
          queryLimit: '10',
          style: 'Card',
          columnCount: '1',
        },
      }

      const result: HMBlockQuery = {
        id: 'foo',
        type: 'Query',
        text: ``,
        annotations: [],
        attributes: {
          style: 'Card',
          columnCount: 1,
          banner: true,
          query: {
            includes: [{space: 'FOO_SPACE', path: '', mode: 'Children'}],
            sort: [{term: 'UpdateTime', reverse: false}],
            limit: 10,
          },
        },
      }

      const val = editorBlockToHMBlock(editorBlock)

      expect(val).toEqual(result)
    })

    // test('nostr', () => {
    //   const editorBlock: EditorNostrBlock = {
    //     id: 'foo',
    //     type: 'nostr',
    //     children: [],
    //     props: {
    //       name: 'test nostr',
    //       url: 'nostr://foobarid',
    //       size: 123456,
    //     },
    //     content: [
    //       {
    //         type: 'text',
    //         text: '',
    //         styles: {},
    //       },
    //     ],
    //   }

    //   const result: HMBlockNostr = {
    //     id: 'foo',
    //     type: 'nostr',
    //     text: ``,
    //     ref: 'nostr://foobarid',
    //     annotations: [],
    //     attributes: {
    //       name: 'test nostr',
    //       size: '123456',
    //     },
    //   }

    //   const val = editorBlockToHMBlock(editorBlock)

    //   expect(val).toEqual(result)
    // })
  })

  describe('childrenType', () => {
    test('Grid', () => {
      const editorBlock: EditorBlock = {
        id: 'foo',
        type: 'paragraph',
        children: [],
        props: {
          childrenType: 'Grid',
          columnCount: '3',
        },
        content: [
          {
            type: 'text',
            text: 'Hello world',
            styles: {},
          },
        ],
      }

      const result: HMBlock = {
        id: 'foo',
        type: 'Paragraph',
        text: 'Hello world',
        annotations: [],
        attributes: {
          childrenType: 'Grid',
          columnCount: 3,
        },
      }
      const val = editorBlockToHMBlock(editorBlock)

      expect(val).toEqual(result)
    })

    test('Grid with columnCount 2', () => {
      const editorBlock: EditorBlock = {
        id: 'foo',
        type: 'paragraph',
        children: [],
        props: {
          childrenType: 'Grid',
          columnCount: '2',
        },
        content: [
          {
            type: 'text',
            text: 'Hello world',
            styles: {},
          },
        ],
      }

      const result: HMBlock = {
        id: 'foo',
        type: 'Paragraph',
        text: 'Hello world',
        annotations: [],
        attributes: {
          childrenType: 'Grid',
          columnCount: 2,
        },
      }
      const val = editorBlockToHMBlock(editorBlock)

      expect(val).toEqual(result)
    })

    test('Group', () => {
      const editorBlock: EditorBlock = {
        id: 'foo',
        type: 'paragraph',
        children: [],
        props: {
          childrenType: 'Group',
        },
        content: [
          {
            type: 'text',
            text: 'Hello world',
            styles: {},
          },
        ],
      }

      const result: HMBlock = {
        id: 'foo',
        type: 'Paragraph',
        text: 'Hello world',
        annotations: [],
        attributes: {
          childrenType: 'Group',
        },
      }
      const val = editorBlockToHMBlock(editorBlock)

      expect(val).toEqual(result)
    })

    test('Unordered', () => {
      const editorBlock: EditorBlock = {
        id: 'foo',
        type: 'paragraph',
        children: [],
        props: {
          childrenType: 'Unordered',
        },
        content: [
          {
            type: 'text',
            text: 'Hello world',
            styles: {},
          },
        ],
      }

      const result: HMBlock = {
        id: 'foo',
        type: 'Paragraph',
        text: 'Hello world',
        annotations: [],
        attributes: {
          childrenType: 'Unordered',
        },
      }
      const val = editorBlockToHMBlock(editorBlock)

      expect(val).toEqual(result)
    })

    test('Ordered', () => {
      const editorBlock: EditorBlock = {
        id: 'foo',
        type: 'paragraph',
        children: [],
        props: {
          childrenType: 'Ordered',
        },
        content: [
          {
            type: 'text',
            text: 'Hello world',
            styles: {},
          },
        ],
      }

      const result: HMBlock = {
        id: 'foo',
        type: 'Paragraph',
        text: 'Hello world',
        annotations: [],
        attributes: {
          childrenType: 'Ordered',
        },
      }
      const val = editorBlockToHMBlock(editorBlock)

      expect(val).toEqual(result)
    })

    test('Ordered with start (deprecated)', () => {
      const editorBlock: EditorBlock = {
        id: 'foo',
        type: 'paragraph',
        children: [],
        props: {
          childrenType: 'Ordered',
          // @ts-expect-error
          start: '5',
        },
        content: [
          {
            type: 'text',
            text: 'Hello world',
            styles: {},
          },
        ],
      }

      const result: HMBlock = {
        id: 'foo',
        type: 'Paragraph',
        text: 'Hello world',
        annotations: [],
        attributes: {
          childrenType: 'Ordered',
        },
      }
      const val = editorBlockToHMBlock(editorBlock)

      expect(val).toEqual(result)
    })

    test('BlockQuote', () => {
      const editorBlock: EditorBlock = {
        id: 'foo',
        type: 'paragraph',
        children: [],
        props: {
          childrenType: 'Blockquote',
        },
        content: [
          {
            type: 'text',
            text: 'Hello quote',
            styles: {},
          },
        ],
      }

      const result: HMBlock = {
        id: 'foo',
        type: 'Paragraph',
        text: 'Hello quote',
        annotations: [],
        attributes: {
          childrenType: 'Blockquote',
        },
      }
      const val = editorBlockToHMBlock(editorBlock)

      expect(val).toEqual(result)
    })

    test('Group (default)', () => {
      const editorBlock: EditorBlock = {
        id: 'foo',
        type: 'paragraph',
        children: [],
        props: {
          childrenType: 'Group',
        },
        content: [
          {
            type: 'text',
            text: 'Hello world',
            styles: {},
          },
        ],
      }

      const result: HMBlock = {
        id: 'foo',
        type: 'Paragraph',
        text: 'Hello world',
        annotations: [],
        attributes: {
          childrenType: 'Group',
        },
      }
      const val = editorBlockToHMBlock(editorBlock)

      expect(val).toEqual(result)
    })

    test('image with childrenType', () => {
      const editorBlock: EditorImageBlock = {
        id: 'foo',
        type: 'image',
        children: [],
        props: {
          url: 'ipfs://foobarcid_IMAGE',
          width: '400',
          childrenType: 'Ordered',
        },
        content: [
          {
            type: 'text',
            text: '',
            styles: {},
          },
        ],
      }

      const result: HMBlockImage = {
        id: 'foo',
        type: 'Image',
        text: ``,
        link: 'ipfs://foobarcid_IMAGE',
        annotations: [],
        attributes: {
          width: 400,
          childrenType: 'Ordered',
        },
      }
      const val = editorBlockToHMBlock(editorBlock)

      expect(val).toEqual(result)
    })

    test('embed with childrenType', () => {
      const editorBlock: EditorEmbedBlock = {
        id: 'foo',
        type: 'embed',
        children: [],
        props: {
          url: 'hm://foobarembed',
          view: 'Card',
          childrenType: 'Unordered',
        },
        content: [
          {
            type: 'text',
            text: '',
            styles: {},
          },
        ],
      }

      const result: HMBlockEmbed = {
        id: 'foo',
        type: 'Embed',
        text: ``,
        link: 'hm://foobarembed',
        annotations: [],
        attributes: {
          view: 'Card',
          childrenType: 'Unordered',
        },
      }

      const val = editorBlockToHMBlock(editorBlock)

      expect(val).toEqual(result)
    })
  })

  describe('color annotations', () => {
    test('emits TextColor annotation with the color name in attributes', () => {
      const editorBlock: EditorBlock = {
        id: 'foo',
        type: 'paragraph',
        children: [],
        props: {},
        content: [
          {text: 'A', type: 'text', styles: {}},
          {text: 'B', type: 'text', styles: {textColor: 'red'}},
          {text: 'C', type: 'text', styles: {}},
        ],
      }

      const val = editorBlockToHMBlock(editorBlock)

      expect(val).toEqual({
        id: 'foo',
        type: 'Paragraph',
        text: 'ABC',
        annotations: [{type: 'TextColor', attributes: {value: 'red'}, link: '', starts: [1], ends: [2]}],
        attributes: {},
      })
    })

    test('emits BackgroundColor annotation distinct from TextColor on the same span', () => {
      const editorBlock: EditorBlock = {
        id: 'foo',
        type: 'paragraph',
        children: [],
        props: {},
        content: [{text: 'highlighted', type: 'text', styles: {textColor: 'red', backgroundColor: 'yellow'}}],
      }

      const val = editorBlockToHMBlock(editorBlock) as Extract<HMBlock, {type: 'Paragraph'}>

      expect(val.annotations).toEqual([
        {type: 'BackgroundColor', attributes: {value: 'yellow'}, link: '', starts: [0], ends: [11]},
        {type: 'TextColor', attributes: {value: 'red'}, link: '', starts: [0], ends: [11]},
      ])
    })

    test('keeps spans with different color values as separate annotations', () => {
      const editorBlock: EditorBlock = {
        id: 'foo',
        type: 'paragraph',
        children: [],
        props: {},
        content: [
          {text: 'AA', type: 'text', styles: {textColor: 'red'}},
          {text: 'BB', type: 'text', styles: {textColor: 'blue'}},
        ],
      }

      const val = editorBlockToHMBlock(editorBlock) as Extract<HMBlock, {type: 'Paragraph'}>

      expect(val.annotations).toEqual([
        {type: 'TextColor', attributes: {value: 'red'}, link: '', starts: [0], ends: [2]},
        {type: 'TextColor', attributes: {value: 'blue'}, link: '', starts: [2], ends: [4]},
      ])
    })

    test('merges adjacent spans that share the same color value', () => {
      const editorBlock: EditorBlock = {
        id: 'foo',
        type: 'paragraph',
        children: [],
        props: {},
        content: [
          {text: 'AA', type: 'text', styles: {textColor: 'red', bold: true}},
          {text: 'BB', type: 'text', styles: {textColor: 'red'}},
        ],
      }

      const val = editorBlockToHMBlock(editorBlock) as Extract<HMBlock, {type: 'Paragraph'}>

      const textColor = val.annotations?.find((a) => a.type === 'TextColor')
      expect(textColor).toEqual({type: 'TextColor', attributes: {value: 'red'}, link: '', starts: [0], ends: [4]})
    })
  })

  describe('unknown blocks', () => {
    test('round-trips an unknown block from originalData without mutating it', () => {
      // The exact corrupt block from issue #807 (an empty-string block type).
      const original = {
        type: '',
        id: 'empty',
        revision: '',
        annotations: [],
        text: '',
        link: '',
      }
      const editorBlock = {
        id: 'empty',
        type: 'unknown',
        children: [],
        content: [],
        props: {
          originalType: '',
          originalData: JSON.stringify(original),
        },
      } as unknown as EditorBlock

      const val = editorBlockToHMBlock(editorBlock)

      expect(val).toEqual(original)
    })

    test('preserves an unknown future block type and its attributes verbatim', () => {
      const original = {
        type: 'Spreadsheet',
        id: 'abc123',
        text: '',
        annotations: [],
        attributes: {rows: 4, columns: 3, data: {a: 1}},
        link: 'hm://example',
      }
      const editorBlock = {
        id: 'abc123',
        type: 'unknown',
        children: [],
        content: [],
        props: {
          originalType: 'Spreadsheet',
          originalData: JSON.stringify(original),
        },
      } as unknown as EditorBlock

      expect(editorBlockToHMBlock(editorBlock)).toEqual(original)
    })

    test('syncs the block id with the editor block when it was regenerated', () => {
      const original = {type: 'Whatever', id: 'oldId', text: '', annotations: [], attributes: {}}
      const editorBlock = {
        id: 'newId',
        type: 'unknown',
        children: [],
        content: [],
        props: {originalType: 'Whatever', originalData: JSON.stringify(original)},
      } as unknown as EditorBlock

      const val = editorBlockToHMBlock(editorBlock) as unknown as {id: string; type: string}
      expect(val.id).toBe('newId')
      expect(val.type).toBe('Whatever')
    })

    test('falls back to a minimal block when originalData is unparseable', () => {
      const editorBlock = {
        id: 'broken',
        type: 'unknown',
        children: [],
        content: [],
        props: {originalType: 'Mystery', originalData: 'not json{'},
      } as unknown as EditorBlock

      expect(editorBlockToHMBlock(editorBlock)).toEqual({
        id: 'broken',
        type: 'Mystery',
        text: '',
        annotations: [],
        attributes: {},
      })
    })

    test('does not throw for an unknown block (regression for issue #807)', () => {
      const editorBlock = {
        id: 'empty',
        type: 'unknown',
        children: [],
        content: [],
        props: {originalType: '', originalData: '{"type":"","id":"empty"}'},
      } as unknown as EditorBlock

      expect(() => editorBlockToHMBlock(editorBlock)).not.toThrow()
    })
  })

  describe('table blocks', () => {
    test('table', () => {
      const editorBlock: EditorBlock = {
        id: 't1',
        type: 'table',
        children: [],
        props: {},
        content: [],
      }

      const val = editorBlockToHMBlock(editorBlock)

      expect(val).toEqual({
        id: 't1',
        type: 'Table',
        text: '',
        annotations: [],
        attributes: {},
      })
    })

    test('tableColumn without a width does not warn and emits no width attribute', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        const editorBlock: EditorBlock = {
          id: 'c1',
          type: 'tableColumn',
          children: [],
          props: {},
          content: [],
        }

        const val = editorBlockToHMBlock(editorBlock)

        expect(val).toEqual({
          id: 'c1',
          type: 'TableColumn',
          text: '',
          annotations: [],
          attributes: {},
        })
        expect(warnSpy).not.toHaveBeenCalled()
      } finally {
        warnSpy.mockRestore()
      }
    })

    test('tableColumn with a width emits the width attribute', () => {
      const editorBlock: EditorBlock = {
        id: 'c1',
        type: 'tableColumn',
        children: [],
        props: {width: '120'},
        content: [],
      }

      const val = editorBlockToHMBlock(editorBlock)

      expect(val).toEqual({
        id: 'c1',
        type: 'TableColumn',
        text: '',
        annotations: [],
        attributes: {width: 120},
      })
    })

    test('paragraph carries columnId when inside a TableRow', () => {
      const editorBlock: EditorBlock = {
        id: 'cell-1',
        type: 'paragraph',
        children: [],
        props: {columnId: 'c-q1'},
        content: [{type: 'text', text: '10', styles: {}}],
      }

      const val = editorBlockToHMBlock(editorBlock) as Extract<HMBlock, {type: 'Paragraph'}>

      expect(val).toEqual({
        id: 'cell-1',
        type: 'Paragraph',
        text: '10',
        annotations: [],
        attributes: {columnId: 'c-q1'},
      })
    })

    test('paragraph outside a TableRow has no columnId attribute', () => {
      const editorBlock: EditorBlock = {
        id: 'p1',
        type: 'paragraph',
        children: [],
        props: {},
        content: [{type: 'text', text: 'hi', styles: {}}],
      }

      const val = editorBlockToHMBlock(editorBlock) as Extract<HMBlock, {type: 'Paragraph'}>

      expect(val.attributes).toEqual({})
    })
  })

  describe('table round-trip', () => {
    type TableBuilderOptions = {
      headerRow?: boolean
      headerCol?: boolean
      text?: (r: number, c: number) => string
    }

    // Build a 3x3 editor table block with stable IDs and per cell text.
    function buildEditorTable({
      headerRow = false,
      headerCol = false,
      text = (r, c) => `r${r}c${c}`,
    }: TableBuilderOptions): EditorBlock {
      const colIds = ['col-0', 'col-1', 'col-2']
      const columns = colIds.map((id, idx) => ({
        id,
        type: 'tableColumn' as const,
        children: [],
        props: idx === 0 && headerCol ? {isHeader: true} : {},
        content: [],
      }))
      const rows = ['row-0', 'row-1', 'row-2'].map((rid, rIdx) => ({
        id: rid,
        type: 'tableRow' as const,
        children: colIds.map((cid, cIdx) => ({
          id: `cell-${rIdx}-${cIdx}`,
          type: 'paragraph' as const,
          children: [],
          props: {columnId: cid},
          content: [{type: 'text' as const, text: text(rIdx, cIdx), styles: {}}],
        })),
        props: rIdx === 0 && headerRow ? {isHeader: true} : {},
        content: [],
      }))
      return {
        id: 'table-1',
        type: 'table',
        children: [...columns, ...rows] as any,
        props: {},
        content: [],
      } as EditorBlock
    }

    // Assert the hmBlock tree's shape matches the expected result for a 3x3 table.
    function assertHmTree(
      hmBlockNodes: HMBlockNode[],
      {headerRow = false, headerCol = false, text = (r, c) => `r${r}c${c}`}: TableBuilderOptions,
    ) {
      expect(hmBlockNodes, 'top-level node count').toHaveLength(1)
      const tableNode = hmBlockNodes[0]
      if (!tableNode) throw new Error('expected a top-level table node')
      expect(tableNode.block?.type, 'top-level type').toBe('Table')
      expect(tableNode.block?.id, 'top-level id').toBe('table-1')

      const cols = (tableNode.children ?? []).filter((c) => c.block?.type === 'TableColumn')
      const rows = (tableNode.children ?? []).filter((c) => c.block?.type === 'TableRow')
      expect(cols, 'TableColumn count').toHaveLength(3)
      expect(rows, 'TableRow count').toHaveLength(3)

      cols.forEach((col, idx) => {
        expect(col.block?.id, `col ${idx} id`).toBe(`col-${idx}`)
        const isHeaderAttr = (col.block as any)?.attributes?.isHeader
        if (idx === 0 && headerCol) expect(isHeaderAttr, `col ${idx} isHeader`).toBe(true)
        else expect(isHeaderAttr, `col ${idx} isHeader`).toBeFalsy()
      })

      rows.forEach((row, rIdx) => {
        expect(row.block?.id, `row ${rIdx} id`).toBe(`row-${rIdx}`)
        const isHeaderAttr = (row.block as any)?.attributes?.isHeader
        if (rIdx === 0 && headerRow) expect(isHeaderAttr, `row ${rIdx} isHeader`).toBe(true)
        else expect(isHeaderAttr, `row ${rIdx} isHeader`).toBeFalsy()

        expect(row.children, `row ${rIdx} children`).toHaveLength(3)
        row.children?.forEach((cell, cIdx) => {
          expect(cell.block?.type, `cell (${rIdx},${cIdx}) type`).toBe('Paragraph')
          expect(cell.block?.id, `cell (${rIdx},${cIdx}) id`).toBe(`cell-${rIdx}-${cIdx}`)
          expect((cell.block as any).text, `cell (${rIdx},${cIdx}) text`).toBe(text(rIdx, cIdx))
          expect((cell.block as any).attributes?.columnId, `cell (${rIdx},${cIdx}) columnId`).toBe(`col-${cIdx}`)
        })
      })
    }

    // Normalize an editor-block tree so we can compare it across a round-trip.
    function normalizeForCompare(value: any): any {
      if (Array.isArray(value)) return value.map(normalizeForCompare)
      if (value && typeof value === 'object') {
        const out: any = {}
        for (const [k, v] of Object.entries(value)) {
          if (k === 'props' && v && typeof v === 'object') {
            const props: any = {...(v as object)}
            out[k] = props
          } else if (
            k === 'content' &&
            Array.isArray(v) &&
            v.length === 1 &&
            (v[0] as any)?.type === 'text' &&
            (v[0] as any)?.text === '' &&
            Object.keys((v[0] as any)?.styles || {}).length === 0
          ) {
            out[k] = []
          } else {
            out[k] = normalizeForCompare(v)
          }
        }
        return out
      }
      return value
    }

    test('3x3 no-headers table round-trips through hmBlockNode format', () => {
      const original = buildEditorTable({})

      const hmBlockNodes = editorBlocksToHMBlockNodes([original])
      assertHmTree(hmBlockNodes, {})

      const back = hmBlocksToEditorContent(hmBlockNodes)
      expect(normalizeForCompare(back)).toEqual([original])
    })

    test('3x3 table with header row round-trips', () => {
      const original = buildEditorTable({headerRow: true})

      const hmBlockNodes = editorBlocksToHMBlockNodes([original])
      assertHmTree(hmBlockNodes, {headerRow: true})

      const back = hmBlocksToEditorContent(hmBlockNodes)
      expect(normalizeForCompare(back)).toEqual([original])
    })

    test('3x3 table with header column only round-trips', () => {
      const original = buildEditorTable({headerCol: true})

      const hmBlockNodes = editorBlocksToHMBlockNodes([original])
      assertHmTree(hmBlockNodes, {headerCol: true})

      const back = hmBlocksToEditorContent(hmBlockNodes)
      expect(normalizeForCompare(back)).toEqual([original])
    })

    test('3x3 table with both header row and header column round-trips', () => {
      const original = buildEditorTable({headerRow: true, headerCol: true})

      const hmBlockNodes = editorBlocksToHMBlockNodes([original])
      assertHmTree(hmBlockNodes, {headerRow: true, headerCol: true})

      const back = hmBlocksToEditorContent(hmBlockNodes)
      expect(normalizeForCompare(back)).toEqual([original])
    })

    test('isHeader on a non 0 pos row is normalized away on save', () => {
      // Build a 3x3 table and mark row[2] as a header row.
      const original = buildEditorTable({})
      const rows = (original.children ?? []).filter((c: any) => c.type === 'tableRow')
      ;(rows[2] as any).props = {isHeader: true}

      const hmBlockNodes = editorBlocksToHMBlockNodes([original])
      const hmRows = (hmBlockNodes[0]?.children ?? []).filter((c) => c.block?.type === 'TableRow')

      // Row 2's illegal isHeader prop should be stripped in the hmBlockNode tree.
      expect((hmRows[2]?.block as any)?.attributes?.isHeader).toBeUndefined()
      // Rows 0 and 1 still don't have isHeader.
      expect((hmRows[0]?.block as any)?.attributes?.isHeader).toBeUndefined()
      expect((hmRows[1]?.block as any)?.attributes?.isHeader).toBeUndefined()
    })

    test('isHeader on a non 0 pos column is normalized away on save', () => {
      // Build a 3x3 table and mark col[1] as a header column.
      const original = buildEditorTable({})
      const cols = (original.children ?? []).filter((c: any) => c.type === 'tableColumn')
      ;(cols[1] as any).props = {isHeader: true}

      const hmBlockNodes = editorBlocksToHMBlockNodes([original])
      const hmCols = (hmBlockNodes[0]?.children ?? []).filter((c) => c.block?.type === 'TableColumn')

      expect((hmCols[1]?.block as any)?.attributes?.isHeader).toBeUndefined()
      expect((hmCols[0]?.block as any)?.attributes?.isHeader).toBeUndefined()
      expect((hmCols[2]?.block as any)?.attributes?.isHeader).toBeUndefined()
    })
  })

  describe('orphan filtering on save', () => {
    test('orphan tableRow at root is dropped from hmBlockNode tree', () => {
      const blocks: EditorBlock[] = [
        {id: 'p1', type: 'paragraph', children: [], props: {}, content: [{type: 'text', text: 'before', styles: {}}]},
        // tableRow at top level (not nested inside a Table).
        {id: 'r-orphan', type: 'tableRow', children: [], props: {}, content: []} as any,
        {id: 'p2', type: 'paragraph', children: [], props: {}, content: [{type: 'text', text: 'after', styles: {}}]},
      ]

      const hmBlockNodes = editorBlocksToHMBlockNodes(blocks)

      expect(hmBlockNodes).toHaveLength(2)
      expect(hmBlockNodes.map((n) => n.block?.id)).toEqual(['p1', 'p2'])
      expect(hmBlockNodes.every((n) => n.block?.type === 'Paragraph')).toBe(true)
    })

    test('orphan tableColumn at root is dropped from hmBlockNode tree', () => {
      const blocks: EditorBlock[] = [
        {id: 'p1', type: 'paragraph', children: [], props: {}, content: [{type: 'text', text: 'hi', styles: {}}]},
        {id: 'c-orphan', type: 'tableColumn', children: [], props: {}, content: []} as any,
        {id: 'p2', type: 'paragraph', children: [], props: {}, content: [{type: 'text', text: 'there', styles: {}}]},
      ]

      const hmBlockNodes = editorBlocksToHMBlockNodes(blocks)

      expect(hmBlockNodes).toHaveLength(2)
      expect(hmBlockNodes.map((n) => n.block?.id)).toEqual(['p1', 'p2'])
    })

    test('tableRow nested under a Table parent is not dropped', () => {
      const table: EditorBlock = {
        id: 'table-1',
        type: 'table',
        props: {},
        content: [],
        children: [
          {id: 'col-0', type: 'tableColumn', props: {}, content: [], children: []},
          {
            id: 'row-0',
            type: 'tableRow',
            props: {},
            content: [],
            children: [
              {
                id: 'cell-0-0',
                type: 'paragraph',
                props: {columnId: 'col-0'},
                content: [{type: 'text', text: 'data', styles: {}}],
                children: [],
              },
            ],
          },
        ] as any,
      } as EditorBlock

      const hmBlockNodes = editorBlocksToHMBlockNodes([table])
      const tableNode = hmBlockNodes[0]
      const rows = (tableNode?.children ?? []).filter((c) => c.block?.type === 'TableRow')
      const cols = (tableNode?.children ?? []).filter((c) => c.block?.type === 'TableColumn')

      // The TableRow / TableColumn under Table survive.
      expect(cols.map((c) => c.block?.id)).toEqual(['col-0'])
      expect(rows.map((r) => r.block?.id)).toEqual(['row-0'])
    })
  })
})
