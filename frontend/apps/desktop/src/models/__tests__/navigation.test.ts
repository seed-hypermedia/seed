import {HMBlockNode, HMNavigationItem} from '@shm/shared/hm-types'
import {describe, expect, it} from 'vitest'
import {getNavigationChanges} from '../navigation'

describe('getNavigationChanges', () => {
  it('should create navigation block when navigation array exists but no old navigation block', () => {
    const navigation: HMNavigationItem[] = []

    const oldNavigationBlockNode: HMBlockNode | undefined = undefined

    const result = getNavigationChanges(navigation, oldNavigationBlockNode)

    expect(result).toHaveLength(1)
    // @ts-ignore
    expect(result[0].op.case).toBe('replaceBlock')
    // @ts-ignore
    expect(result[0].op.value).toMatchObject({
      id: 'navigation',
      type: 'Group',
    })
  })

  it('should create navigation block when navigation items exist and no old navigation block', () => {
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

    expect(result).toHaveLength(3)
    // @ts-ignore
    expect(result[0].op.case).toBe('replaceBlock')
    // @ts-ignore
    expect(result[0].op.value).toMatchObject({
      id: 'navigation',
      type: 'Group',
    })
    // @ts-ignore
    expect(result[1].op.case).toBe('replaceBlock')
    // @ts-ignore
    expect(result[1].op.value).toMatchObject({
      id: 'nav1',
      text: 'Home',
      link: 'hm://home',
      type: 'Link',
    })
    // @ts-ignore
    expect(result[2].op.case).toBe('moveBlock')
    // @ts-ignore
    expect(result[2].op.value).toMatchObject({
      blockId: 'nav1',
      leftSibling: '',
      parent: 'navigation',
    })
  })
})

describe('getNavigationChanges - update scenarios', () => {
  it('should add a new navigation item', () => {
    const oldNavigationBlockNode: HMBlockNode = {
      block: {id: 'navigation', type: 'Group'},
      children: [
        {block: {id: 'nav1', type: 'Link', text: 'Home', link: 'hm://home'}},
      ],
    }
    const navigation: HMNavigationItem[] = [
      {id: 'nav1', text: 'Home', link: 'hm://home', type: 'Link'},
      {id: 'nav2', text: 'About', link: 'hm://about', type: 'Link'},
    ]
    const result = getNavigationChanges(navigation, oldNavigationBlockNode)
    expect(result).toHaveLength(3)
    // @ts-ignore
    expect(result[0].op.case).toBe('moveBlock')
    // @ts-ignore
    expect(result[0].op.value).toMatchObject({
      blockId: 'nav1',
      parent: 'navigation',
      leftSibling: '',
    })
    // @ts-ignore
    expect(result[1].op.case).toBe('replaceBlock')
    // @ts-ignore
    expect(result[1].op.value).toMatchObject({
      id: 'nav2',
      text: 'About',
      link: 'hm://about',
      type: 'Link',
    })
    // @ts-ignore
    expect(result[2].op.case).toBe('moveBlock')
    // @ts-ignore
    expect(result[2].op.value).toMatchObject({
      blockId: 'nav2',
      parent: 'navigation',
      leftSibling: 'nav1',
    })
  })

  it('should remove a navigation item', () => {
    const oldNavigationBlockNode: HMBlockNode = {
      block: {id: 'navigation', type: 'Group'},
      children: [
        {block: {id: 'nav1', type: 'Link', text: 'Home', link: 'hm://home'}},
        {block: {id: 'nav2', type: 'Link', text: 'About', link: 'hm://about'}},
      ],
    }
    const navigation: HMNavigationItem[] = [
      {id: 'nav1', text: 'Home', link: 'hm://home', type: 'Link'},
    ]
    const result = getNavigationChanges(navigation, oldNavigationBlockNode)
    expect(result).toHaveLength(2)
    // @ts-ignore
    expect(result[0].op.case).toBe('deleteBlock')
    // @ts-ignore
    expect(result[0].op.value).toBe('nav2')
    // @ts-ignore
    expect(result[1].op.case).toBe('moveBlock')
    // @ts-ignore
    expect(result[1].op.value).toMatchObject({
      blockId: 'nav1',
      parent: 'navigation',
      leftSibling: '',
    })
  })

  it('should move a navigation item', () => {
    const oldNavigationBlockNode: HMBlockNode = {
      block: {id: 'navigation', type: 'Group'},
      children: [
        {block: {id: 'nav1', type: 'Link', text: 'Home', link: 'hm://home'}},
        {block: {id: 'nav2', type: 'Link', text: 'About', link: 'hm://about'}},
      ],
    }
    const navigation: HMNavigationItem[] = [
      {id: 'nav2', text: 'About', link: 'hm://about', type: 'Link'},
      {id: 'nav1', text: 'Home', link: 'hm://home', type: 'Link'},
    ]
    const result = getNavigationChanges(navigation, oldNavigationBlockNode)
    expect(result).toHaveLength(2)
    // @ts-ignore
    expect(result[0].op.case).toBe('moveBlock')
    // @ts-ignore
    expect(result[0].op.value).toMatchObject({
      blockId: 'nav2',
      leftSibling: '',
      parent: 'navigation',
    })
    // @ts-ignore
    expect(result[1].op.case).toBe('moveBlock')
    // @ts-ignore
    expect(result[1].op.value).toMatchObject({
      blockId: 'nav1',
      leftSibling: 'nav2',
      parent: 'navigation',
    })
  })

  it('should update a navigation item (replaceBlock)', () => {
    const oldNavigationBlockNode: HMBlockNode = {
      block: {id: 'navigation', type: 'Group'},
      children: [
        {block: {id: 'nav1', type: 'Link', text: 'Home', link: 'hm://home'}},
      ],
    }
    const navigation: HMNavigationItem[] = [
      {id: 'nav1', text: 'Homepage', link: 'hm://home', type: 'Link'},
    ]
    const result = getNavigationChanges(navigation, oldNavigationBlockNode)
    expect(result).toHaveLength(2)
    // @ts-ignore
    expect(result[0].op.case).toBe('replaceBlock')
    // @ts-ignore
    expect(result[0].op.value).toMatchObject({
      id: 'nav1',
      text: 'Homepage',
      link: 'hm://home',
      type: 'Link',
    })
    // @ts-ignore
    expect(result[1].op.case).toBe('moveBlock')
    // @ts-ignore
    expect(result[1].op.value).toMatchObject({
      blockId: 'nav1',
      parent: 'navigation',
      leftSibling: '',
    })
  })

  it('should do nothing if navigation is unchanged', () => {
    const oldNavigationBlockNode: HMBlockNode = {
      block: {id: 'navigation', type: 'Group'},
      children: [
        {block: {id: 'nav1', type: 'Link', text: 'Home', link: 'hm://home'}},
      ],
    }
    const navigation: HMNavigationItem[] = [
      {id: 'nav1', text: 'Home', link: 'hm://home', type: 'Link'},
    ]
    const result = getNavigationChanges(navigation, oldNavigationBlockNode)
    expect(result).toHaveLength(1)
    // @ts-ignore
    expect(result[0].op.case).toBe('moveBlock')
    // @ts-ignore
    expect(result[0].op.value).toMatchObject({
      blockId: 'nav1',
      parent: 'navigation',
      leftSibling: '',
    })
  })
})
