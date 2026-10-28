import {describe, expect, it} from 'vitest'
import {closedOverlayArgs, countStories, inlineStoryReason} from './story-policy'

describe('inline story policy', () => {
  it('counts the entire catalogue before any stories mount', () => {
    expect(
      countStories([
        {title: 'Components/Button', args: {}, source: '<Button>Save</Button>'},
        {title: 'Components/ImageCropDialog', args: {input: null}, source: ''},
        {title: 'Components/ImageCropDialog', args: {input: {file: 'fixture'}}, source: ''},
        {title: 'Components/Toaster', args: {}, source: ''},
        {title: 'Pages/DocumentPagePermissions', args: {}, source: ''},
        {title: 'Example', args: {}, source: '<Dialog open>'},
      ]),
    ).toEqual({total: 6, storybookOnly: 4})
    expect(countStories([])).toEqual({total: 0, storybookOnly: 0})
  })
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
