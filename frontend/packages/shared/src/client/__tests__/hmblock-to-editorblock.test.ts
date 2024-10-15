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
  HMBlockFile,
  HMBlockHeading,
  HMBlockImage,
  HMBlockMath,
  HMBlockNostr,
  HMBlockWebEmbed,
} from '../../hm-types'
import {hmBlockToEditorBlock} from '../hmblock-to-editorblock'

describe('HMBlock to EditorBlock', () => {
  describe('blockTypes', () => {
    test('paragraph', () => {
      const hmBlock: HMBlock = {
        id: 'foo',
        type: 'Paragraph',
        text: 'Hello world',
        annotations: [],
        attributes: {},
        revision: 'revision123',
      }

      const result: EditorBlock = {
        id: 'foo',
        type: 'paragraph',
        children: [],
        props: {
          revision: 'revision123',
        },
        content: [
          {
            type: 'text',
            text: 'Hello world',
            styles: {},
          },
        ],
      }
      const val = hmBlockToEditorBlock(hmBlock)

      expect(val).toEqual(result)
    })

    test('paragraph with styles formats', () => {
      const hmBlock: HMBlock = {
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
        revision: 'revision123',
      }

      const result: EditorBlock = {
        id: 'foo',
        type: 'paragraph',
        children: [],
        props: {
          revision: 'revision123',
        },
        content: [
          {text: 'A', type: 'text', styles: {bold: true}},
          {text: 'B', type: 'text', styles: {italic: true}},
          {text: 'C', type: 'text', styles: {underline: true}},
          {text: 'D', type: 'text', styles: {strike: true}},
          {text: 'E', type: 'text', styles: {code: true}},
        ],
      }
      const val = hmBlockToEditorBlock(hmBlock)

      expect(val).toEqual(result)
    })

    test('paragraph with overlapping styles formats', () => {
      const hmBlock: HMBlock = {
        id: 'foo',
        type: 'Paragraph',
        text: 'ABCDE',
        annotations: [
          {type: 'Bold', attributes: {}, link: '', starts: [1], ends: [3]},
          {type: 'Italic', attributes: {}, link: '', starts: [2], ends: [4]},
        ],
        attributes: {},
        revision: 'revision123',
      }

      const result: EditorBlock = {
        id: 'foo',
        type: 'paragraph',
        children: [],
        props: {
          revision: 'revision123',
        },
        content: [
          {text: 'A', type: 'text', styles: {}},
          {text: 'B', type: 'text', styles: {bold: true}},
          {text: 'C', type: 'text', styles: {bold: true, italic: true}},
          {text: 'D', type: 'text', styles: {italic: true}},
          {text: 'E', type: 'text', styles: {}},
        ],
      }
      const val = hmBlockToEditorBlock(hmBlock)

      expect(val).toEqual(result)
    })

    test('paragraph with emojis and format', () => {
      const hmBlock: HMBlock = {
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
        revision: 'revision123',
      }
      const result: EditorBlock = {
        id: 'foo',
        type: 'paragraph',
        children: [],
        props: {
          revision: 'revision123',
        },
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
      const val = hmBlockToEditorBlock(hmBlock)

      expect(val).toEqual(result)
    })

    test('paragraph with link', () => {
      const hmBlock: HMBlock = {
        id: 'foo',
        type: 'Paragraph',
        text: 'Hello world',
        annotations: [
          {
            type: 'Link',
            attributes: {},
            link: 'https://example.com',
            starts: [6],
            ends: [11],
          },
        ],
        attributes: {},
        revision: 'revision123',
      }
      const result: EditorBlock = {
        id: 'foo',
        type: 'paragraph',
        children: [],
        props: {
          revision: 'revision123',
        },
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
      const val = hmBlockToEditorBlock(hmBlock)
      //   console.log(`== ~ LINK ~ val:`, JSON.stringify(val, null, 2))
      expect(val).toEqual(result)
    })

    test('paragraph with link and more content', () => {
      const hmBlock: HMBlock = {
        id: 'foo',
        type: 'Paragraph',
        text: 'Hello world and all of you!',
        annotations: [
          {
            type: 'Link',
            attributes: {},
            starts: [6],
            ends: [11],
            link: 'https://example.com',
          },
          {
            type: 'Bold',
            attributes: {},
            link: '',
            starts: [23],
            ends: [27],
          },
        ],
        attributes: {},
        revision: 'revision123',
      }
      const result: EditorBlock = {
        id: 'foo',
        type: 'paragraph',
        children: [],
        props: {
          revision: 'revision123',
        },
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
      const val = hmBlockToEditorBlock(hmBlock)
      expect(val).toEqual(result)
    })

    test('paragraph with inline embed', () => {
      const hmBlock: HMBlock = {
        id: 'foo',
        type: 'Paragraph',
        text: 'Hello \uFFFC',
        annotations: [
          {
            type: 'Embed',
            starts: [6],
            attributes: {},
            ends: [7],
            link: 'hm://asdf1234',
          },
        ],
        attributes: {},
        revision: 'revision123',
      }
      const result: EditorBlock = {
        id: 'foo',
        type: 'paragraph',
        children: [],
        props: {
          revision: 'revision123',
        },
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
      const val = hmBlockToEditorBlock(hmBlock)
      expect(val).toEqual(result)
    })

    test('paragraph with inline embed and more content', () => {
      const hmBlock: HMBlock = {
        id: 'foo',
        type: 'Paragraph',
        text: 'Hello \uFFFC how are you?',
        annotations: [
          {
            type: 'Embed',
            starts: [6],
            attributes: {},
            ends: [7],
            link: 'hm://asdf1234',
          },
          {
            type: 'Bold',
            starts: [7],
            ends: [16],
            attributes: {},
            link: '',
          },
          {
            type: 'Strike',
            starts: [16],
            ends: [20],
            attributes: {},
            link: '',
          },
        ],
        attributes: {},
        revision: 'revision123',
      }
      const result: EditorBlock = {
        id: 'foo',
        type: 'paragraph',
        children: [],
        props: {
          revision: 'revision123',
        },
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
            text: ' how are ',
            styles: {
              bold: true,
            },
          },
          {
            type: 'text',
            text: 'you?',
            styles: {
              strike: true,
            },
          },
        ],
      }
      const val = hmBlockToEditorBlock(hmBlock)
      expect(val).toEqual(result)
    })

    test('heading', () => {
      const hmBlock: HMBlockHeading = {
        id: 'foo',
        type: 'Heading',
        text: 'Hello world',
        annotations: [],
        attributes: {},
        revision: 'revision123',
      }

      const result: EditorHeadingBlock = {
        id: 'foo',
        type: 'heading',
        children: [],
        props: {
          revision: 'revision123',
        },
        content: [
          {
            type: 'text',
            text: 'Hello world',
            styles: {},
          },
        ],
      }
      const val = hmBlockToEditorBlock(hmBlock)

      expect(val).toEqual(result)
    })

    test('code', () => {
      const hmBlock: HMBlockCode = {
        id: 'foo',
        type: 'Code',
        text: `const hello = 'world'`,
        annotations: [],
        attributes: {
          language: 'javascript',
        },
        revision: 'revision123',
      }

      const result: EditorCodeBlock = {
        id: 'foo',
        type: 'code-block',
        children: [],
        props: {
          language: 'javascript',
          revision: 'revision123',
        },
        content: [
          {
            type: 'text',
            text: `const hello = 'world'`,
            styles: {},
          },
        ],
      }
      const val = hmBlockToEditorBlock(hmBlock)

      expect(val).toEqual(result)
    })

    test('math', () => {
      const hmBlock: HMBlockMath = {
        id: 'foo',
        type: 'Math',
        text: `MATH HERE`,
        annotations: [],
        attributes: {},
        revision: 'revision123',
      }

      const result: EditorMathBlock = {
        id: 'foo',
        type: 'math',
        children: [],
        props: {
          revision: 'revision123',
        },
        content: [
          {
            type: 'text',
            text: `MATH HERE`,
            styles: {},
          },
        ],
      }
      const val = hmBlockToEditorBlock(hmBlock)

      expect(val).toEqual(result)
    })

    test('image', () => {
      const hmBlock: HMBlockImage = {
        id: 'foo',
        type: 'Image',
        text: ``,
        link: 'ipfs://foobarimgcid',
        annotations: [],
        attributes: {},
        revision: 'revision123',
      }

      const result: EditorImageBlock = {
        id: 'foo',
        type: 'image',
        children: [],
        props: {
          url: 'ipfs://foobarimgcid',
          revision: 'revision123',
        },
        content: [
          {
            type: 'text',
            text: '',
            styles: {},
          },
        ],
      }
      const val = hmBlockToEditorBlock(hmBlock)

      expect(val).toEqual(result)
    })

    test('video', () => {
      const hmBlock: HMBlock = {
        id: 'foo',
        type: 'Video',
        text: ``,
        link: 'ipfs://foobarimgcid',
        annotations: [],
        attributes: {
          width: '240',
          name: 'test demo video',
          // size: '123456',
        },
        revision: 'revision123',
      }

      const result: EditorVideoBlock = {
        id: 'foo',
        type: 'video',
        children: [],
        props: {
          url: 'ipfs://foobarimgcid',
          width: 240,
          name: 'test demo video',
          // size: 123456,
          revision: 'revision123',
        },
        content: [
          {
            type: 'text',
            text: '',
            styles: {},
          },
        ],
      }
      const val = hmBlockToEditorBlock(hmBlock)

      expect(val).toEqual(result)
    })

    test('file', () => {
      const hmBlock: HMBlockFile = {
        id: 'foo',
        type: 'File',
        text: ``,
        link: 'ipfs://foobarimgcid',
        annotations: [],
        attributes: {
          name: 'testfile.pdf',
          size: '123456',
        },
        revision: 'revision123',
      }

      const result: EditorFileBlock = {
        id: 'foo',
        type: 'file',
        children: [],
        props: {
          url: 'ipfs://foobarimgcid',
          name: 'testfile.pdf',
          size: 123456,
          revision: 'revision123',
        },
        content: [
          {
            type: 'text',
            text: '',
            styles: {},
          },
        ],
      }

      const val = hmBlockToEditorBlock(hmBlock)

      expect(val).toEqual(result)
    })

    test('embed', () => {
      const hmBlock: HMBlockEmbed = {
        id: 'foo',
        type: 'Embed',
        text: ``,
        link: 'hm://foobarembed',
        annotations: [],
        attributes: {
          view: 'Card',
        },
        revision: 'revision123',
      }

      const result: EditorEmbedBlock = {
        id: 'foo',
        type: 'embed',
        children: [],
        props: {
          url: 'hm://foobarembed',
          view: 'Card',
          revision: 'revision123',
        },
        content: [
          {
            type: 'text',
            text: '',
            styles: {},
          },
        ],
      }

      const val = hmBlockToEditorBlock(hmBlock)

      expect(val).toEqual(result)
    })

    test('web embed', () => {
      const hmBlock: HMBlockWebEmbed = {
        id: 'foo',
        type: 'WebEmbed',
        text: ``,
        link: 'hm://foobarwebembed',
        annotations: [],
        attributes: {},
        revision: 'revision123',
      }

      const result: EditorWebEmbedBlock = {
        id: 'foo',
        type: 'web-embed',
        children: [],
        props: {
          url: 'hm://foobarwebembed',
          revision: 'revision123',
        },
        content: [
          {
            type: 'text',
            text: '',
            styles: {},
          },
        ],
      }

      const val = hmBlockToEditorBlock(hmBlock)

      expect(val).toEqual(result)
    })

    test('nostr', () => {
      const hmBlock: HMBlockNostr = {
        id: 'foo',
        type: 'Nostr',
        text: ``,
        link: 'nostr://foobarid',
        annotations: [],
        attributes: {
          name: 'test nostr',
          size: '123456',
        },
        revision: 'revision123',
      }

      const result: EditorNostrBlock = {
        id: 'foo',
        type: 'nostr',
        children: [],
        props: {
          name: 'test nostr',
          url: 'nostr://foobarid',
          size: 123456,
          revision: 'revision123',
        },
        content: [
          {
            type: 'text',
            text: '',
            styles: {},
          },
        ],
      }

      const val = hmBlockToEditorBlock(hmBlock)

      expect(val).toEqual(result)
    })
  })

  describe('childrenType', () => {
    test('Group', () => {
      const result: EditorBlock = {
        id: 'foo',
        type: 'paragraph',
        children: [],
        props: {
          childrenType: 'Group',
          revision: 'revision123',
        },
        content: [
          {
            type: 'text',
            text: 'Hello world',
            styles: {},
          },
        ],
      }

      const hmBlock: HMBlock = {
        id: 'foo',
        type: 'Paragraph',
        text: 'Hello world',
        annotations: [],
        revision: 'revision123',
        attributes: {
          childrenType: 'Group',
        },
      }
      const val = hmBlockToEditorBlock(hmBlock)

      expect(val).toEqual(result)
    })

    test('Unordered', () => {
      const result: EditorBlock = {
        id: 'foo',
        type: 'paragraph',
        children: [],
        props: {
          revision: 'revision123',
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

      const hmBlock: HMBlock = {
        id: 'foo',
        type: 'Paragraph',
        text: 'Hello world',
        revision: 'revision123',
        annotations: [],
        attributes: {
          childrenType: 'Unordered',
        },
      }
      const val = hmBlockToEditorBlock(hmBlock)

      expect(val).toEqual(result)
    })

    test('Ordered', () => {
      const result: EditorBlock = {
        id: 'foo',
        type: 'paragraph',
        children: [],
        props: {
          childrenType: 'Ordered',
          start: '5',
          revision: 'revision123',
        },
        content: [
          {
            type: 'text',
            text: 'Hello world',
            styles: {},
          },
        ],
      }

      const hmBlock: HMBlock = {
        id: 'foo',
        type: 'Paragraph',
        text: 'Hello world',
        revision: 'revision123',
        annotations: [],
        attributes: {
          childrenType: 'Ordered',
          start: '5',
        },
      }
      const val = hmBlockToEditorBlock(hmBlock)

      expect(val).toEqual(result)
    })
  })
})
