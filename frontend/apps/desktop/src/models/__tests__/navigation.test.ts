import {HMBlockNode, HMNavigationItem} from '@shm/shared/hm-types'
import {describe, expect, it} from 'vitest'
import {getNavigationChanges} from '../navigation'

describe('getNavigationChanges', () => {
  it('should create navigation block when navigation items exist but no old navigation block', () => {
    const navigation: HMNavigationItem[] = [
      {
        id: 'nav1',
        text: 'Home',
        link: 'hm://home',
        type: 'Link',
      },
    ]

    const oldNavigationBlockNode: HMBlockNode | undefined = undefined

    const result = getNavigationChanges(navigation, oldNavigationBlockNode)

    expect(result).toHaveLength(1)
    expect(result[0].op.case).toBe('replaceBlock')
    expect(result[0].op.value).toMatchObject({
      id: 'navigation',
      type: 'Group',
    })
  })
})
