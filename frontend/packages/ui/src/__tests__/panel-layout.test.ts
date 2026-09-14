import {describe, expect, it} from 'vitest'
import {getPanelHeaderState} from '../panel-layout'

describe('panel header state', () => {
  it('labels a block citations panel and hides activity filters', () => {
    expect(getPanelHeaderState('activity', false, true)).toEqual({
      title: 'Citations',
      showActivityFilters: false,
    })
  })
})
