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

  it('adds ipfs:// cover and logo (as the header logo) only when their CIDs are provided', () => {
    const withImages = createSpaceMetadata(stateWith({}), {coverCid: 'bafcover', logoCid: 'bafylogo'})
    expect(withImages.cover).toBe('ipfs://bafcover')
    expect(withImages.seedExperimentalLogo).toBe('ipfs://bafylogo')

    const withoutImages = createSpaceMetadata(stateWith({}), {})
    expect(withoutImages).not.toHaveProperty('cover')
    expect(withoutImages).not.toHaveProperty('seedExperimentalLogo')
  })

  it('adds only the image that has a CID', () => {
    const coverOnly = createSpaceMetadata(stateWith({}), {coverCid: 'bafcover'})
    expect(coverOnly.cover).toBe('ipfs://bafcover')
    expect(coverOnly).not.toHaveProperty('seedExperimentalLogo')
  })
})
