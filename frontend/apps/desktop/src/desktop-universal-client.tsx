import {useSelectedAccountContacts} from '@/models/contacts'
import {useListDirectory} from '@/models/documents'
import {
  useAccountsMetadata,
  useSubscribedResource,
  useSubscribedResources,
} from '@/models/entities'
import type {UnpackedHypermediaId} from '@shm/shared'
import type {UniversalClient} from '@shm/shared/universal-client'
import {CommentBox} from './components/commenting'

export const desktopUniversalClient: UniversalClient = {
  useResource: ((
    id: UnpackedHypermediaId | null | undefined,
    options?: {recursive?: boolean},
  ) => {
    return useSubscribedResource(id, options?.recursive)
  }) as UniversalClient['useResource'],
  useResources: (ids: (UnpackedHypermediaId | null | undefined)[]) => {
    return useSubscribedResources(ids.map((id) => ({id, recursive: false})))
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
}
