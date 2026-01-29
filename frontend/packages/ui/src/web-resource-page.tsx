import {UnpackedHypermediaId, useUniversalAppContext} from '@shm/shared'
import {HypermediaHostBanner} from './hm-host-banner'
import {
  CommentEditorProps,
  MobileConfig,
  ResourcePage,
} from './resource-page-common'

export interface WebResourcePageProps {
  docId: UnpackedHypermediaId
  /** Platform-specific comment editor component */
  CommentEditor?: React.ComponentType<CommentEditorProps>
  /** Mobile-specific configuration */
  mobileConfig?: MobileConfig
}

/**
 * Web-specific wrapper for ResourcePage that handles:
 * - HypermediaHostBanner (shown when viewing content from a different site)
 */
export function WebResourcePage({
  docId,
  CommentEditor,
  mobileConfig,
}: WebResourcePageProps) {
  const {origin, originHomeId} = useUniversalAppContext()

  // Show banner when viewing content from a different site than the host
  const siteUid = docId.uid
  const showBanner = origin && originHomeId && siteUid !== originHomeId.uid

  return (
    <>
      {showBanner && <HypermediaHostBanner origin={origin} />}
      <ResourcePage
        docId={docId}
        CommentEditor={CommentEditor}
        mobileConfig={mobileConfig}
      />
    </>
  )
}
