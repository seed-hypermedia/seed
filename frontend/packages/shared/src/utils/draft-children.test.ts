import {HMListedDraft} from '@seed-hypermedia/client/hm-types'
import {describe, expect, it} from 'vitest'
import {hmId} from './entity-id-url'
import {filterChildDrafts} from './draft-children'

function draft({
  id,
  locationPath,
  editPath,
}: {
  id: string
  locationPath?: string[]
  editPath?: string[]
}): HMListedDraft {
  const locationId = locationPath ? hmId('acct', {path: locationPath}) : undefined
  const editId = editPath ? hmId('acct', {path: editPath}) : undefined
  return {
    id,
    locationUid: locationPath ? 'acct' : undefined,
    locationPath,
    editUid: editPath ? 'acct' : undefined,
    editPath,
    metadata: {name: ''},
    visibility: 'PUBLIC',
    deps: [],
    lastUpdateTime: 1,
    locationId,
    editId,
  } as HMListedDraft
}

describe('filterChildDrafts', () => {
  it('keeps drafts located under the parent while excluding drafts editing the parent itself', () => {
    const parentId = hmId('acct', {path: ['parent']})
    const childDraft = draft({
      id: 'child-draft',
      locationPath: ['parent'],
      editPath: ['parent', '-child-draft'],
    })
    const selfDraft = draft({
      id: 'self-draft',
      locationPath: ['parent'],
      editPath: ['parent'],
    })
    const siblingDraft = draft({
      id: 'sibling-draft',
      locationPath: ['sibling'],
      editPath: ['sibling', '-sibling-draft'],
    })

    expect(filterChildDrafts([childDraft, selfDraft, siblingDraft], parentId)).toEqual([childDraft])
  })

  it('keeps root child drafts with an empty root location path', () => {
    const rootId = hmId('acct', {path: []})
    const childDraft = draft({
      id: 'root-child-draft',
      locationPath: [],
      editPath: ['-root-child-draft'],
    })

    expect(filterChildDrafts([childDraft], rootId)).toEqual([childDraft])
  })
})
