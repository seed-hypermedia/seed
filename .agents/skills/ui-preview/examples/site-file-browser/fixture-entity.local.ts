import {hmId} from '@shm/shared'

// Every visual state of a row: collection, document, private document, nested children and an unpublished draft.
const tree: [path: string, name: string, kind?: 'collection' | 'private'][] = [
  ['papers', 'Academic Papers', 'collection'],
  ['papers/one', 'Paper'],
  ['design', 'Design'],
  ['design/activities', 'Activities', 'collection'],
  ['design/activities/one', 'Activity log'],
  ['design/activity', 'Activity'],
  ['design/status', 'Design Work Status', 'private'],
  ['design/stories', 'Stories'],
  ['design/stories/explore', 'Explore and Organize'],
  ['design/stories/explore/attribute', 'As an Editor, I want to add an attribute'],
  ['design/stories/explore/blocks', 'Content block system'],
  ['design/user-stories', 'User Stories', 'collection'],
  ['design/user-stories/one', 'Story'],
]

const directory = tree.map(([path, name, kind]) => ({
  id: hmId('site', {path: path.split('/')}),
  path: path.split('/'),
  metadata: {name},
  visibility: kind === 'private' ? 'PRIVATE' : 'PUBLIC',
  isCollection: kind === 'collection',
}))

const drafts = [
  {
    id: 'draft-1',
    metadata: {name: 'Content hierarchy'},
    locationId: hmId('site', {path: ['design', 'stories', 'explore']}),
    editId: hmId('site', {path: ['design', 'stories', 'explore', '-draft-1']}),
  },
]

/** Fixture replacement for the real directory hook. */
export function useDirectoryWithDrafts() {
  return {directory, drafts, isLoading: false}
}
