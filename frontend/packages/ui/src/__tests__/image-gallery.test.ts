import {describe, expect, it} from 'vitest'
import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import {collectImageBlocks, resolveGalleryNavigation, resolveSwipeDirection} from '../blocks-content'
import type {ImageGalleryItem} from '../blocks-content'

// -- Factories --

function makeImageBlock(id: string, link: string, name?: string): HMBlockNode {
  return {
    block: {
      id,
      type: 'Image' as const,
      link,
      text: '',
      annotations: [],
      attributes: {name},
    },
  }
}

function makeParagraphBlock(id: string): HMBlockNode {
  return {
    block: {
      id,
      type: 'Paragraph' as const,
      text: 'some text',
      annotations: [],
      attributes: {},
    },
  }
}

function makeHeadingBlock(id: string): HMBlockNode {
  return {
    block: {
      id,
      type: 'Heading' as const,
      text: 'heading',
      annotations: [],
      attributes: {},
    },
  }
}

function makeItems(count: number): ImageGalleryItem[] {
  return Array.from({length: count}, (_, i) => ({
    blockId: `img-${i}`,
    link: `ipfs://cid-${i}`,
  }))
}

// -- collectImageBlocks --

describe('collectImageBlocks', () => {
  it('returns empty array for empty block list', () => {
    expect(collectImageBlocks([])).toEqual([])
  })

  it('collects images from flat list in order', () => {
    const blocks: HMBlockNode[] = [
      makeParagraphBlock('p1'),
      makeImageBlock('img1', 'ipfs://cid1', 'photo.jpg'),
      makeParagraphBlock('p2'),
      makeImageBlock('img2', 'ipfs://cid2'),
    ]
    expect(collectImageBlocks(blocks)).toEqual([
      {blockId: 'img1', link: 'ipfs://cid1', name: 'photo.jpg'},
      {blockId: 'img2', link: 'ipfs://cid2', name: undefined},
    ])
  })

  it('skips non-image blocks', () => {
    const blocks: HMBlockNode[] = [
      makeParagraphBlock('p1'),
      makeHeadingBlock('h1'),
      makeParagraphBlock('p2'),
    ]
    expect(collectImageBlocks(blocks)).toEqual([])
  })

  it('skips image blocks with empty link', () => {
    const blocks: HMBlockNode[] = [
      makeImageBlock('img1', ''),
      makeImageBlock('img2', 'ipfs://cid2'),
    ]
    expect(collectImageBlocks(blocks)).toEqual([
      {blockId: 'img2', link: 'ipfs://cid2', name: undefined},
    ])
  })

  it('collects from nested children in DFS order', () => {
    const blocks: HMBlockNode[] = [
      makeImageBlock('imgA', 'ipfs://a'),
      {
        ...makeParagraphBlock('p1'),
        children: [
          makeImageBlock('imgB', 'ipfs://b'),
          makeImageBlock('imgC', 'ipfs://c'),
        ],
      },
      makeImageBlock('imgD', 'ipfs://d'),
    ]
    const result = collectImageBlocks(blocks)
    expect(result.map((r) => r.blockId)).toEqual(['imgA', 'imgB', 'imgC', 'imgD'])
  })

  it('collects deeply nested images', () => {
    const blocks: HMBlockNode[] = [
      {
        ...makeParagraphBlock('p1'),
        children: [
          {
            ...makeParagraphBlock('p2'),
            children: [
              {
                ...makeParagraphBlock('p3'),
                children: [makeImageBlock('deep', 'ipfs://deep')],
              },
            ],
          },
        ],
      },
    ]
    expect(collectImageBlocks(blocks)).toEqual([
      {blockId: 'deep', link: 'ipfs://deep', name: undefined},
    ])
  })

  it('preserves name attribute', () => {
    const blocks: HMBlockNode[] = [makeImageBlock('img1', 'ipfs://cid1', 'my-photo.png')]
    expect(collectImageBlocks(blocks)[0]!.name).toBe('my-photo.png')
  })
})

// -- resolveGalleryNavigation --

describe('resolveGalleryNavigation', () => {
  it('returns null for empty image list', () => {
    expect(resolveGalleryNavigation([], 0, 'next')).toBeNull()
    expect(resolveGalleryNavigation([], 0, 'prev')).toBeNull()
  })

  it('next from first returns 1', () => {
    const images = makeItems(3)
    expect(resolveGalleryNavigation(images, 0, 'next')).toBe(1)
  })

  it('prev from first returns null', () => {
    const images = makeItems(3)
    expect(resolveGalleryNavigation(images, 0, 'prev')).toBeNull()
  })

  it('next from last returns null', () => {
    const images = makeItems(3)
    expect(resolveGalleryNavigation(images, 2, 'next')).toBeNull()
  })

  it('prev from last returns lastIdx - 1', () => {
    const images = makeItems(3)
    expect(resolveGalleryNavigation(images, 2, 'prev')).toBe(1)
  })

  it('navigates both ways from middle', () => {
    const images = makeItems(5)
    expect(resolveGalleryNavigation(images, 2, 'next')).toBe(3)
    expect(resolveGalleryNavigation(images, 2, 'prev')).toBe(1)
  })

  it('single image: both directions return null', () => {
    const images = makeItems(1)
    expect(resolveGalleryNavigation(images, 0, 'next')).toBeNull()
    expect(resolveGalleryNavigation(images, 0, 'prev')).toBeNull()
  })
})

// -- resolveSwipeDirection --

describe('resolveSwipeDirection', () => {
  it('returns next for swipe left (negative delta exceeding threshold)', () => {
    expect(resolveSwipeDirection(-51)).toBe('next')
    expect(resolveSwipeDirection(-100)).toBe('next')
  })

  it('returns prev for swipe right (positive delta exceeding threshold)', () => {
    expect(resolveSwipeDirection(51)).toBe('prev')
    expect(resolveSwipeDirection(100)).toBe('prev')
  })

  it('returns null for small delta below threshold', () => {
    expect(resolveSwipeDirection(30)).toBeNull()
    expect(resolveSwipeDirection(-30)).toBeNull()
    expect(resolveSwipeDirection(0)).toBeNull()
  })

  it('returns null for delta exactly at threshold (must exceed)', () => {
    expect(resolveSwipeDirection(50)).toBeNull()
    expect(resolveSwipeDirection(-50)).toBeNull()
  })
})
