import {HMResource, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {packHmId} from '@shm/shared'
import {ArrowRight, Ban, FileQuestion, Loader, Radar, SignpostBig, TriangleAlert} from 'lucide-react'
import {Link} from 'react-router-dom'
import {exploreHref, isProfileId} from '../utils/exploreHref'
import {useDiscoverResource} from '../utils/useDiscoverResource'
import {CopyTextButton} from './CopyTextButton'
import {OpenInAppButton} from './ExternalOpenButton'

const panelClass = 'rounded-xl border border-gray-200 bg-white p-6'

/**
 * Renders resource states that are not a document or comment: redirects,
 * tombstones, not-found, and errors. Redirects are shown (not followed) with a
 * link to the destination so the user can choose to navigate there.
 */
export function ResourceStatus({data}: {data: HMResource}) {
  if (data.type === 'redirect') {
    return <RedirectStatus id={data.id} target={data.redirectTarget} republish={data.republish} />
  }

  if (data.type === 'tombstone') {
    return (
      <div className={panelClass}>
        <div className="mb-2 flex items-center gap-2 text-lg font-bold text-gray-800">
          <Ban className="size-5 text-red-500" />
          Deleted
        </div>
        <p className="text-gray-600">
          This {isProfileId(data.id) ? 'profile' : 'resource'} has been deleted (tombstoned).
        </p>
      </div>
    )
  }

  if (data.type === 'not-found') {
    return <NotFoundStatus id={data.id} />
  }

  if (data.type === 'error') {
    return (
      <div className={panelClass}>
        <div className="mb-2 flex items-center gap-2 text-lg font-bold text-gray-800">
          <TriangleAlert className="size-5 text-amber-500" />
          Error
        </div>
        <p className="font-mono text-sm break-words text-red-600">{data.message}</p>
      </div>
    )
  }

  return null
}

/**
 * Not-found panel with a Discover action. The configured host doesn't have the
 * resource locally, so this pokes the daemon's network discovery and refetches
 * once the content arrives.
 */
function NotFoundStatus({id}: {id: UnpackedHypermediaId}) {
  const kind = isProfileId(id) ? 'profile' : 'resource'
  const {state, discover} = useDiscoverResource(id)
  const isDiscovering = state.status === 'discovering'

  return (
    <div className={panelClass}>
      <div className="mb-2 flex items-center gap-2 text-lg font-bold text-gray-800">
        <FileQuestion className="size-5 text-gray-500" />
        Not Found
      </div>
      <p className="mb-4 text-gray-600">
        No {kind} was found at this address on the configured host. Try discovering it on the network.
      </p>

      <button
        onClick={discover}
        disabled={isDiscovering}
        className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-300"
      >
        {isDiscovering ? <Loader className="size-4 animate-spin" /> : <Radar className="size-4" />}
        {isDiscovering ? 'Discovering…' : 'Discover on the network'}
      </button>

      {state.status === 'failed' && (
        <p className="mt-3 text-sm text-red-600">{state.error || 'Discovery failed.'}</p>
      )}
    </div>
  )
}

function RedirectStatus({
  id,
  target,
  republish,
}: {
  id: UnpackedHypermediaId
  target: UnpackedHypermediaId
  republish: boolean
}) {
  const targetUrl = packHmId(target)
  const kind = isProfileId(id) ? 'profile' : 'document'

  return (
    <div className={panelClass}>
      <div className="mb-2 flex items-center gap-2 text-lg font-bold text-gray-800">
        <SignpostBig className="size-5 text-blue-600" />
        Redirect
      </div>
      <p className="mb-4 text-gray-600">
        This {kind} redirects to another {republish ? 'resource (republished content)' : kind}. The explorer does not
        follow redirects automatically.
      </p>

      <div className="mb-1 text-sm font-bold text-gray-700">Destination</div>
      <div className="flex flex-wrap items-center gap-2 overflow-hidden">
        <ArrowRight className="size-4 flex-shrink-0 text-gray-400" />
        <Link to={exploreHref(target)} className="font-mono break-all text-blue-600 underline hover:underline">
          {targetUrl}
        </Link>
        <CopyTextButton text={targetUrl} />
        <OpenInAppButton url={targetUrl} />
      </div>
    </div>
  )
}

export default ResourceStatus
