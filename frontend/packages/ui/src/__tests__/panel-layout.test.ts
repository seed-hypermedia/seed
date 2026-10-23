import {describe, expect, it} from 'vitest'
import {getPanelHeaderState, getPanelMinPercent} from '../panel-layout'

describe('panel header state', () => {
  it('labels a block citations panel and hides activity filters', () => {
    expect(getPanelHeaderState('activity', false, true)).toEqual({
      title: 'Citations',
      showActivityFilters: false,
    })
  })
})

describe('panel minimum width', () => {
  it('keeps the panel at least 250px wide as the window narrows', () => {
    expect(getPanelMinPercent(2000)).toBe(20)
    expect(getPanelMinPercent(1000)).toBeCloseTo(25)
  })

  it('never asks for more than half the container', () => {
    expect(getPanelMinPercent(400)).toBe(50)
  })

  it('falls back to the default before the container is measured', () => {
    expect(getPanelMinPercent(0)).toBe(20)
  })
})
