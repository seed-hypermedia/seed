import {describe, expect, test} from 'vitest'
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
} from '../../editor-types'
import {
  HMBlock,
  HMBlockCode,
  HMBlockEmbed,
  HMBlockHeading,
  HMBlockImage,
  HMBlockMath,
  HMBlockQuery,
  HMBlockWebEmbed,
} from '../../hm-types'
import {editorBlockToHMBlock} from '../editorblock-to-hmblock'

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

    test('image wrong width value should be removed (percentage)', () => {
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
        attributes: {},
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
          queryIncludes:
            '[{"space": "FOO_SPACE", "path": "", "mode": "Children"}]',
          querySort: '[{"term": "UpdateTime", "reverse": false}]',

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
})
