import {useSelectedAccountContacts} from '@/models/contacts'
import {useListDirectory} from '@/models/documents'
import {
  loadAccount,
  loadBatchAccounts,
  loadQuery,
  loadResource,
  useAccountsMetadata,
} from '@/models/entities'
import {deleteRecent, loadRecents} from '@/models/recents'
import {loadSearchQuery} from '@/models/search'
import type {UnpackedHypermediaId} from '@shm/shared'
import {useResource, useResources} from '@shm/shared/models/entity'
import type {UniversalClient} from '@shm/shared/universal-client'
import {CommentBox} from './components/commenting'

export const desktopUniversalClient: UniversalClient = {
  useResource: ((
    id: UnpackedHypermediaId | null | undefined,
    _options?: {recursive?: boolean},
  ) => {
    return useResource(id)
  }) as UniversalClient['useResource'],
  useResources: (ids: (UnpackedHypermediaId | null | undefined)[]) => {
    return useResources(ids)
  },
  useDirectory: useListDirectory,
  useContacts: () => {
    const contacts = useSelectedAccountContacts()
    // PlainMessage<Contact> is compatible with Contact for our purposes
    // Cast the entire result to satisfy the UniversalClient interface
    return contacts as any
  },
  useAccountsMetadata: useAccountsMetadata,
  CommentEditor: ({docId}: {docId: UnpackedHypermediaId}) => (
    <CommentBox docId={docId} context="document-content" />
  ),

  loadSearch: loadSearchQuery,
  loadQuery: loadQuery,
  loadResource: loadResource,
  loadAccount: loadAccount,
  loadBatchAccounts: loadBatchAccounts,
  loadRecents: loadRecents,
  deleteRecent: deleteRecent,
}
