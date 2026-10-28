import {describe, expect, it} from 'vitest'
import {closedOverlayArgs, inlineStoryReason} from './story-policy'

describe('inline story policy', () => {
  it('closes every supported public overlay input without changing other props', () => {
    expect(closedOverlayArgs({open: true, defaultOpen: true, isOpen: true, title: 'Panel'})).toEqual({
      open: false,
      defaultOpen: false,
      isOpen: false,
    })
    expect(closedOverlayArgs({})).toEqual({})
  })
  it('renders ordinary and empty stories', () => {
    expect(inlineStoryReason('Components/Button', {}, '<Button>Save</Button>')).toBe('')
    expect(inlineStoryReason('', {}, '')).toBe('')
  })
  it('keeps both direct and wrapped hardcoded overlays isolated', () => {
    for (const source of [
      '<Dialog open>',
      '<AlertDialog open={true}>',
      '<DocumentPagePermissionSettings open onOpenChange={() => {}} />',
      '<Popover defaultOpen>',
    ])
      expect(inlineStoryReason('Example', {}, source)).toContain('hardcodes an open overlay')
    expect(inlineStoryReason('Example', {}, '<Dialog open={false}>')).toBe('')
    expect(inlineStoryReason('Example', {}, '<Dialog open={args.open}>')).toBe('')
  })
  it('recognizes internal modals that do not expose a closed state', () => {
    for (const title of ['Pages/DocumentPageParameters', 'Pages/DocumentPagePermissions'])
      expect(inlineStoryReason(title, {}, '')).toContain('no closed-state input')
    expect(inlineStoryReason('Components/ImageCropDialog', {input: {file: 'fixture'}}, '')).toContain('crop input')
    expect(inlineStoryReason('Components/ImageCropDialog', {input: null}, '')).toBe('')
  })
  it('avoids duplicate notification hosts', () => {
    expect(inlineStoryReason('Components/Toaster', {}, '')).toContain('Global toast host')
  })
})
