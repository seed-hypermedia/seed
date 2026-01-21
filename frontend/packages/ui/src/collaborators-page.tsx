import {HMRawCapability, UnpackedHypermediaId, useRouteLink} from '@shm/shared'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {entityQueryPathToHmIdPath} from '@shm/shared/utils/path-api'
import {useCapabilities, useResource} from '@shm/shared/models/entity'
import {Users} from 'lucide-react'
import {ReactNode, useMemo} from 'react'
import {HMIcon} from './hm-icon'
import {OpenInPanelButton} from './open-in-panel'
import {PageLayout} from './page-layout'
import {Spinner} from './spinner'
import {SizableText} from './text'

export interface CollaboratorsPageContentProps {
  docId: UnpackedHypermediaId
  /** Content to render in the collaborators area - platform-specific */
  children?: ReactNode
  /** Whether to show the "Open in Panel" button. Defaults to true. */
  showOpenInPanel?: boolean
  /** Whether to show the title. Defaults to true. */
  showTitle?: boolean
  /** Custom max width for centered content */
  contentMaxWidth?: number
}

/**
 * Full-page collaborators content component.
 * The actual collaborator management UI is platform-specific (desktop has complex
 * access control, web may have different needs), so this component provides the
 * layout shell and accepts children for the platform-specific content.
 */
export function CollaboratorsPageContent({
  docId,
  children,
  showOpenInPanel = true,
  showTitle = true,
  contentMaxWidth,
}: CollaboratorsPageContentProps) {
  return (
    <PageLayout
      title={showTitle ? 'Collaborators' : undefined}
      centered
      contentMaxWidth={contentMaxWidth}
      headerRight={
        showOpenInPanel ? (
          <OpenInPanelButton
            id={docId}
            panelRoute={{key: 'collaborators', id: docId}}
          />
        ) : undefined
      }
    >
      <div className="p-6">{children}</div>
    </PageLayout>
  )
}

export function CollaboratorsEmpty() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16">
      <Users className="text-muted-foreground size-16" />
      <SizableText color="muted" weight="medium" size="xl">
        No collaborators yet
      </SizableText>
      <SizableText color="muted" size="sm">
        Add collaborators to share access to this document
      </SizableText>
    </div>
  )
}

function getRoleDisplayName(role: string | undefined): string {
  if (role === 'WRITER' || role === 'writer') return 'Writer'
  if (role === 'AGENT' || role === 'agent') return 'Device'
  if (role === 'OWNER' || role === 'owner') return 'Owner'
  return role || 'Unknown'
}

/** Transformed capability with grantId for parent capability detection */
export type CollaboratorCapability = {
  id: string
  accountUid: string
  role: string
  grantId: UnpackedHypermediaId
}

/** Transform raw capability to collaborator capability */
function transformCapability(
  raw: HMRawCapability,
): CollaboratorCapability | null {
  if (!raw.delegate || !raw.account) return null
  return {
    id: raw.id || '',
    accountUid: raw.delegate,
    role: raw.role || 'unknown',
    grantId: hmId(raw.account, {
      path: entityQueryPathToHmIdPath(raw.path),
    }),
  }
}

/** Shared hook to fetch and prepare collaborators data */
export function useCollaboratorsData(docId: UnpackedHypermediaId) {
  const capabilities = useCapabilities(docId)

  const processedData = useMemo(() => {
    const rawCaps = capabilities.data?.capabilities || []

    // Transform and filter capabilities
    const allCaps = rawCaps
      .map(transformCapability)
      .filter((cap): cap is CollaboratorCapability => cap !== null)

    // Filter out agents (devices) and owners - matching desktop behavior
    const filteredCaps = allCaps.filter(
      (cap) =>
        cap.role !== 'AGENT' &&
        cap.role !== 'agent' &&
        cap.role !== 'OWNER' &&
        cap.role !== 'owner',
    )

    // Separate parent capabilities from direct grants
    const parentCapabilities = filteredCaps.filter(
      (cap) => cap.grantId.id !== docId.id,
    )
    const grantedCapabilities = filteredCaps.filter(
      (cap) => cap.grantId.id === docId.id,
    )

    // Deduplicate by accountUid
    const seen = new Set<string>()
    const dedupeList = (list: CollaboratorCapability[]) =>
      list.filter((cap) => {
        if (seen.has(cap.accountUid)) return false
        seen.add(cap.accountUid)
        return true
      })

    return {
      parentCapabilities: dedupeList(parentCapabilities),
      grantedCapabilities: dedupeList(grantedCapabilities),
      publisherUid: docId.uid,
    }
  }, [capabilities.data, docId.id, docId.uid])

  return {
    ...processedData,
    isLoading: capabilities.isLoading,
    isInitialLoading: capabilities.isInitialLoading,
  }
}

/** Publisher/Owner display component */
function PublisherCollaborator({uid}: {uid: string}) {
  const publisherId = hmId(uid)
  const resource = useResource(publisherId)
  const linkProps = useRouteLink({key: 'document', id: publisherId})

  const metadata =
    resource.data?.type === 'document'
      ? resource.data.document?.metadata
      : undefined
  const isLoading = resource.isLoading

  return (
    <a
      {...linkProps}
      className="hover:bg-muted flex items-center gap-3 rounded-md p-3 transition-colors"
    >
      <HMIcon
        id={publisherId}
        name={isLoading ? undefined : metadata?.name}
        icon={isLoading ? undefined : metadata?.icon}
        size={32}
      />
      <div className="flex flex-1 items-center gap-2 overflow-hidden">
        <SizableText size="sm" className="flex-1 truncate">
          {isLoading ? 'Loading...' : metadata?.name || uid}
        </SizableText>
        <SizableText size="xs" color="muted">
          Publisher
        </SizableText>
      </div>
    </a>
  )
}

/** Read-only collaborators list view - shared between web and desktop */
export function CollaboratorsListView({
  parentCapabilities,
  grantedCapabilities,
  publisherUid,
  docId,
}: {
  parentCapabilities: CollaboratorCapability[]
  grantedCapabilities: CollaboratorCapability[]
  publisherUid: string
  docId: UnpackedHypermediaId
}) {
  const hasNoCollaborators =
    parentCapabilities.length === 0 && grantedCapabilities.length === 0

  return (
    <div className="flex flex-col gap-4">
      {/* Publisher always shown first */}
      <PublisherCollaborator uid={publisherUid} />

      {/* Parent capabilities section */}
      {parentCapabilities.length > 0 && (
        <div className="flex flex-col gap-1">
          {parentCapabilities.map((cap) => (
            <CollaboratorListItem
              key={cap.accountUid}
              capability={cap}
              docId={docId}
            />
          ))}
        </div>
      )}

      {/* Granted section */}
      {grantedCapabilities.length > 0 && (
        <div className="flex flex-col gap-1">
          <SizableText size="xs" color="muted" className="px-3 py-2">
            Granted
          </SizableText>
          {grantedCapabilities.map((cap) => (
            <CollaboratorListItem
              key={cap.accountUid}
              capability={cap}
              docId={docId}
            />
          ))}
        </div>
      )}

      {hasNoCollaborators && (
        <SizableText size="sm" color="muted" className="px-3 py-2">
          No additional collaborators
        </SizableText>
      )}
    </div>
  )
}

function CollaboratorListItem({
  capability,
  docId,
}: {
  capability: CollaboratorCapability
  docId: UnpackedHypermediaId
}) {
  const collaboratorId = hmId(capability.accountUid)
  const resource = useResource(collaboratorId)
  const linkProps = useRouteLink({key: 'document', id: collaboratorId})

  const metadata =
    resource.data?.type === 'document'
      ? resource.data.document?.metadata
      : undefined
  const isLoading = resource.isLoading
  const isParentCapability = capability.grantId.id !== docId.id

  return (
    <a
      {...linkProps}
      className="hover:bg-muted flex items-center gap-3 rounded-md p-3 transition-colors"
    >
      <HMIcon
        id={collaboratorId}
        name={isLoading ? undefined : metadata?.name}
        icon={isLoading ? undefined : metadata?.icon}
        size={32}
      />
      <div className="flex flex-1 items-center gap-2 overflow-hidden">
        <SizableText size="sm" className="flex-1 truncate">
          {isLoading ? 'Loading...' : metadata?.name || capability.accountUid}
        </SizableText>
        <SizableText size="xs" color="muted">
          {getRoleDisplayName(capability.role)}
          {isParentCapability ? ' (Parent Capability)' : ''}
        </SizableText>
      </div>
    </a>
  )
}

/** Full read-only collaborators content with data fetching */
export function ReadOnlyCollaboratorsContent({
  docId,
}: {
  docId: UnpackedHypermediaId
}) {
  const {
    parentCapabilities,
    grantedCapabilities,
    publisherUid,
    isInitialLoading,
  } = useCollaboratorsData(docId)

  if (isInitialLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner className="size-8" />
      </div>
    )
  }

  return (
    <CollaboratorsListView
      parentCapabilities={parentCapabilities}
      grantedCapabilities={grantedCapabilities}
      publisherUid={publisherUid}
      docId={docId}
    />
  )
}
