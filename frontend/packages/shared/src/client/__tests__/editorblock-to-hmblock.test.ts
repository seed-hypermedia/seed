import {
  EditorBlock,
  EditorCodeBlock,
  EditorEmbedBlock,
  EditorFileBlock,
  EditorHeadingBlock,
  EditorImageBlock,
  EditorMathBlock,
  EditorNostrBlock,
  EditorVideoBlock,
  EditorWebEmbedBlock,
} from '@shm/desktop/src/editor'
import {describe, expect, test} from 'vitest'
import {
  HMBlock,
  HMBlockCode,
  HMBlockEmbed,
  HMBlockHeading,
  HMBlockImage,
  HMBlockMath,
  HMBlockNostr,
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
        type: 'paragraph',
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
        type: 'paragraph',
        text: 'ABCDE',
        annotations: [
          {type: 'bold', starts: [0], ends: [1]},
          {type: 'italic', starts: [1], ends: [2]},
          {type: 'underline', starts: [2], ends: [3]},
          {type: 'strike', starts: [3], ends: [4]},
          {type: 'code', starts: [4], ends: [5]},
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
        type: 'paragraph',
        text: 'ABCDE',
        annotations: [
          {type: 'bold', starts: [1], ends: [3]},
          {type: 'italic', starts: [2], ends: [4]},
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
        type: 'paragraph',
        text: '👨‍👩‍👧‍👦 Hello world!',
        annotations: [
          {
            type: 'bold',
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
            ref: 'https://example.com',
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
        type: 'paragraph',
        text: 'Hello world',
        annotations: [
          {
            type: 'link',
            starts: [6],
            ends: [11],
            ref: 'https://example.com',
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
            ref: 'hm://asdf1234',
            styles: {},
          },
        ],
      }

      const result: HMBlock = {
        id: 'foo',
        type: 'paragraph',
        text: 'Hello \uFFFC',
        annotations: [
          {
            type: 'inline-embed',
            starts: [6],
            ends: [7],
            ref: 'hm://asdf1234',
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
            ref: 'hm://asdf1234',
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
        type: 'paragraph',
        text: 'Hello \uFFFC how are you?',
        annotations: [
          {
            type: 'inline-embed',
            starts: [6],
            ends: [7],
            ref: 'hm://asdf1234',
          },
          {
            type: 'italic',
            starts: [8],
            ends: [15],
          },
          {
            type: 'bold',
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
        type: 'heading',
        text: 'Hello world',
        annotations: [],
        attributes: {},
      }
      const val = editorBlockToHMBlock(editorBlock)

      expect(val).toEqual(result)
    })

    test('codeBlock', () => {
      const editorBlock: EditorCodeBlock = {
        id: 'foo',
        type: 'codeBlock',
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
        type: 'codeBlock',
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
        type: 'math',
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
          url: 'ipfs://foobarimgcid',
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
        type: 'image',
        text: ``,
        ref: 'ipfs://foobarimgcid',
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
          url: 'ipfs://foobarimgcid',
          width: 240,
          name: 'test demo video',
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
        type: 'video',
        text: ``,
        ref: 'ipfs://foobarimgcid',
        annotations: [],
        attributes: {
          width: '240',
          name: 'test demo video',
          size: '123456',
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
          url: 'ipfs://foobarimgcid',
          width: 240,
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
        type: 'file',
        text: ``,
        ref: 'ipfs://foobarimgcid',
        annotations: [],
        attributes: {
          width: '240',
          name: 'testfile.pdf',
          size: '123456',
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
          ref: 'hm://foobarembed',
          view: 'card',
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
        type: 'embed',
        text: ``,
        ref: 'hm://foobarembed',
        annotations: [],
        attributes: {
          view: 'card',
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
          ref: 'hm://foobarwebembed',
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
        type: 'web-embed',
        text: ``,
        ref: 'hm://foobarwebembed',
        annotations: [],
        attributes: {},
      }

      const val = editorBlockToHMBlock(editorBlock)

      expect(val).toEqual(result)
    })

    test('nostr', () => {
      const editorBlock: EditorNostrBlock = {
        id: 'foo',
        type: 'nostr',
        children: [],
        props: {
          name: 'test nostr',
          ref: 'nostr://foobarid',
          size: 123456,
        },
        content: [
          {
            type: 'text',
            text: '',
            styles: {},
          },
        ],
      }

      const result: HMBlockNostr = {
        id: 'foo',
        type: 'nostr',
        text: ``,
        ref: 'nostr://foobarid',
        annotations: [],
        attributes: {
          name: 'test nostr',
          size: '123456',
        },
      }

      const val = editorBlockToHMBlock(editorBlock)

      expect(val).toEqual(result)
    })
  })
})
