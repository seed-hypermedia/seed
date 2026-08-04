// @vitest-environment jsdom
import {describe, expect, it} from 'vitest'
import {defaultCreateSpaceFormState, type CreateSpaceFormState} from '../create-space-form'
import {createSpaceMetadata} from '../create-space-platform'

function stateWith(overrides: Partial<CreateSpaceFormState>): CreateSpaceFormState {
  return {...defaultCreateSpaceFormState, ...overrides}
}

describe('createSpaceMetadata', () => {
  it('maps the collected form fields onto home-doc metadata', () => {
    const metadata = createSpaceMetadata(stateWith({name: 'My Space', contentWidth: 'M', showActivity: false}), {})
    expect(metadata).toEqual({
      name: 'My Space',
      contentWidth: 'M',
      showActivity: false,
      theme: {headerLayout: ''},
    })
  })

  it('stores the header-layout value from the layout table, not the form value', () => {
    expect(createSpaceMetadata(stateWith({headerLayout: 'horizontal'}), {}).theme).toEqual({headerLayout: ''})
    expect(createSpaceMetadata(stateWith({headerLayout: 'center'}), {}).theme).toEqual({headerLayout: 'Center'})
  })

  it('maps cover, logo and favicon from their CIDs', () => {
    const withImages = createSpaceMetadata(stateWith({}), {
      coverCid: 'bafcover',
      logoCid: 'bafylogo',
      faviconCid: 'bafyfav',
    })
    expect(withImages.cover).toBe('ipfs://bafcover')
    expect(withImages.seedExperimentalLogo).toBe('ipfs://bafylogo')
    expect(withImages.icon).toBe('ipfs://bafyfav')

    const withoutImages = createSpaceMetadata(stateWith({}), {})
    expect(withoutImages).not.toHaveProperty('cover')
    expect(withoutImages).not.toHaveProperty('seedExperimentalLogo')
    expect(withoutImages).not.toHaveProperty('icon')
  })

  it('adds only the image that has a CID', () => {
    const coverOnly = createSpaceMetadata(stateWith({}), {coverCid: 'bafcover'})
    expect(coverOnly.cover).toBe('ipfs://bafcover')
    expect(coverOnly).not.toHaveProperty('seedExperimentalLogo')
    expect(coverOnly).not.toHaveProperty('icon')
  })
})
