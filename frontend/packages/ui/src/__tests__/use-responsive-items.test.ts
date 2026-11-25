import {describe, expect, it} from 'vitest'
import {splitResponsiveItems} from '../use-responsive-items'

const items = [{key: 'home'}, {key: 'about'}, {key: 'blog'}]

describe('splitResponsiveItems', () => {
  it('preserves order and includes every item exactly once', () => {
    const result = splitResponsiveItems({
      items,
      containerWidth: 220,
      reservedWidth: 40,
      overflowTriggerWidth: 30,
      getWidth: () => 70,
    })

    expect(result.visibleItems.map((item) => item.key)).toEqual(['home', 'about'])
    expect(result.overflowItems.map((item) => item.key)).toEqual(['blog'])
  })

  it('does not let a shorter item jump ahead of one that overflowed', () => {
    const widths: Record<string, number> = {home: 50, about: 100, blog: 30}
    const result = splitResponsiveItems({
      items,
      containerWidth: 120,
      overflowTriggerWidth: 30,
      getWidth: (item) => widths[item.key]!,
    })

    expect(result.visibleItems.map((item) => item.key)).toEqual(['home'])
    expect(result.overflowItems.map((item) => item.key)).toEqual(['about', 'blog'])
  })

  it('allows Home to overflow like other inactive items', () => {
    const result = splitResponsiveItems({
      items,
      activeKey: 'blog',
      containerWidth: 130,
      reservedWidth: 30,
      overflowTriggerWidth: 30,
      getWidth: () => 70,
    })

    expect(result.visibleItems.map((item) => item.key)).toEqual(['blog'])
    expect(result.overflowItems.map((item) => item.key)).toEqual(['home', 'about'])
  })

  it('does not reserve an overflow trigger when every item fits', () => {
    const result = splitResponsiveItems({
      items: items.slice(0, 2),
      containerWidth: 140,
      overflowTriggerWidth: 30,
      getWidth: () => 70,
    })

    expect(result.visibleItems).toEqual(items.slice(0, 2))
    expect(result.overflowItems).toEqual([])
  })
})
