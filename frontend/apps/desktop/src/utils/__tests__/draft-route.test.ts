import {describe, expect, it} from 'vitest'
import {getDraftDisplayMetadata} from '../draft-route'

describe('getDraftDisplayMetadata', () => {
  it('inherits unchanged metadata from the published document', () => {
    expect(getDraftDisplayMetadata({}, {name: 'Published title', icon: 'published-icon'})).toEqual({
      name: 'Published title',
      icon: 'published-icon',
    })
  })

  it('uses draft metadata when the draft changes a field', () => {
    expect(
      getDraftDisplayMetadata(
        {name: 'Draft title', icon: 'draft-icon'},
        {name: 'Published title', icon: 'published-icon'},
      ),
    ).toEqual({name: 'Draft title', icon: 'draft-icon'})
  })

  it('uses draft metadata for a new unpublished document', () => {
    expect(getDraftDisplayMetadata({name: 'New document'}, null)).toEqual({name: 'New document'})
  })
})
