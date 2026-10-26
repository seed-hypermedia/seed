import {describe, expect, it} from 'vitest'
import {readPanelLayout, updatePanelLayout} from '../resizable-panels'

const ids = ['main', 'accessory']
describe('saved panel layouts', () => {
  it('migrates v2 layout arrays in DOM order, not the sorted storage key order', () => {
    expect(readPanelLayout(JSON.stringify({'accessory,main': {layout: [68, 32]}}), ids)).toEqual({
      version: 1,
      layout: {main: 68, accessory: 32},
      expanded: {main: 68, accessory: 32},
    })
  })
  it('retains the last expanded width when a panel collapses', () => {
    const saved = readPanelLayout(JSON.stringify({'accessory,main': {layout: [68, 32]}}), ids)
    const closed = updatePanelLayout(saved, {main: 100, accessory: 0})
    expect(closed.layout.accessory).toBe(0)
    expect(closed.expanded.accessory).toBe(32)
    expect(readPanelLayout(JSON.stringify(closed), ids)).toEqual(closed)
  })
  it('restores v2 expandToSizes when the saved panel is collapsed', () => {
    const saved = readPanelLayout(
      JSON.stringify({
        'accessory,main': {
          layout: [100, 0],
          expandToSizes: {accessory: 32},
        },
      }),
      ids,
    )
    expect(saved?.expanded.accessory).toBe(32)
  })
  it.each([
    'bad json',
    '0',
    'null',
    '{"accessory,main":{"layout":[50,20]}}',
    '{"accessory,main":{"layout":[-1,101]}}',
    '{"accessory,main":{"layout":["70",30]}}',
  ])('rejects invalid saved data: %s', (raw) => {
    expect(readPanelLayout(raw, ids)).toBeUndefined()
  })
  it('rejects records from another group or schema version', () => {
    expect(readPanelLayout(JSON.stringify({version: 2, layout: {main: 70, accessory: 30}}), ids)).toBeUndefined()
    expect(readPanelLayout(JSON.stringify({version: 1, layout: {left: 70, right: 30}}), ids)).toBeUndefined()
  })
  it('migrates the old contact split with generated identifiers only when unambiguous', () => {
    expect(
      readPanelLayout(JSON.stringify({'20,40': {layout: [28, 72]}}), ['contacts', 'contact'], true)?.layout,
    ).toEqual({contacts: 28, contact: 72})
    expect(
      readPanelLayout(
        JSON.stringify({'20,40': {layout: [28, 72]}, other: {layout: [50, 50]}}),
        ['contacts', 'contact'],
        true,
      ),
    ).toBeUndefined()
  })
})
