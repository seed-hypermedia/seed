import {useUpdateHomeDocument} from '@/models/site'
import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useIsSiteOwner} from '@shm/shared/models/capabilities'
import {useResource} from '@shm/shared/models/entity'
import {HeaderAddLink} from '@shm/ui/space-settings-navigation'

/** The top bar's Add or edit links button, offered to the space's owner, who publishes the home document. */
export function EditNavHeaderPane({homeId}: {homeId: UnpackedHypermediaId}) {
  const {isSiteOwner} = useIsSiteOwner(homeId.uid)
  const homeResource = useResource(homeId, {subscribed: true})
  const updateHome = useUpdateHomeDocument(homeId.uid)
  const homeDocument = homeResource.data?.type === 'document' ? homeResource.data.document : null

  if (!isSiteOwner || !homeDocument) return null
  return <HeaderAddLink siteId={homeId} document={homeDocument} updateHome={updateHome} />
}
