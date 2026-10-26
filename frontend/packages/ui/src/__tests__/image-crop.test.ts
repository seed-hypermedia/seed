import {describe, expect, test} from 'vitest'
import {cropOutputFormat, cropOutputSize} from '../image-crop'

describe('cropOutputSize', () => {
  test('scales a crop down so its longest edge meets the limit', () => {
    expect(cropOutputSize({width: 4000, height: 1000}, 1600)).toEqual({width: 1600, height: 400})
    expect(cropOutputSize({width: 1000, height: 4000}, 1600)).toEqual({width: 400, height: 1600})
  })

  test('leaves a crop that already fits at its own size', () => {
    expect(cropOutputSize({width: 800, height: 600}, 1600)).toEqual({width: 800, height: 600})
  })

  test('never upscales, so a small selection keeps its own resolution', () => {
    expect(cropOutputSize({width: 64, height: 64}, 512)).toEqual({width: 64, height: 64})
  })

  test('preserves the aspect ratio, to within whole-pixel rounding', () => {
    const {width, height} = cropOutputSize({width: 3000, height: 2000}, 512)
    expect({width, height}).toEqual({width: 512, height: 341})
    expect(width / height).toBeCloseTo(1.5, 2)
  })

  test('keeps an extreme crop at least one pixel tall', () => {
    expect(cropOutputSize({width: 5000, height: 3}, 512).height).toBe(1)
  })
})

describe('cropOutputFormat', () => {
  test('keeps PNG for sources that can carry transparency', () => {
    for (const type of ['image/png', 'image/webp', 'image/gif', 'image/avif', 'image/svg+xml']) {
      expect(cropOutputFormat(type)).toBe('image/png')
    }
  })

  test('emits JPEG for photographs, which have no transparency to lose', () => {
    expect(cropOutputFormat('image/jpeg')).toBe('image/jpeg')
  })

  test('falls back to JPEG for an unrecognised type', () => {
    expect(cropOutputFormat('')).toBe('image/jpeg')
    expect(cropOutputFormat('application/octet-stream')).toBe('image/jpeg')
  })
})
