import {
  HMBlockNode,
  HMCapability,
  HMComment,
  HMContactRecord,
  HMDocument,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {
  commentIdToHmId,
  createInspectIpfsNavRoute,
  createInspectNavRouteFromRoute,
  createRouteFromInspectNavRoute,
  entityQueryPathToHmIdPath,
  hmId,
  hypermediaUrlToRoute,
  packHmId,
  useCommentVersions,
} from '@shm/shared'
import {useRouteLink} from '@shm/shared/routing'
import {useContactListOfSubject} from '@shm/shared/models/contacts'
import {
  useAuthoredComments,
  useCapabilities,
  useChanges,
  useChildrenList,
  useCitations,
  useComments,
  useResource,
} from '@shm/shared/models/entity'
import {activityFilterToSlug, getCommentTargetId} from '@shm/shared/utils/entity-id-url'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {Button} from './button'
import {DataViewer} from './data-viewer'
import {DocumentTools} from './document-tools'
import {InspectorShell} from './inspector-shell'
import {PageDeleted, PageDiscovery, PageNotFound, PagePrivate} from './page-message-states'
import {Spinner} from './spinner'
import {FileText, Folder, History, LucideIcon, MessageSquare, MessagesSquare, Quote, Shield, Users} from 'lucide-react'
import {ReactNode, useCallback, useMemo} from 'react'
import type {InspectTab} from '@shm/shared/routes'

type InspectRouteType = Extract<ReturnType<typeof useNavRoute>, {key: 'inspect'}>
type InspectorResourceData = Exclude<ReturnType<typeof useResource>['data'], null | undefined>

/** Renders a dedicated raw-data inspector for documents and comments. */
export function InspectorPage({docId, pageFooter}: {docId: UnpackedHypermediaId; pageFooter?: ReactNode}) {
  const route = useNavRoute()
  if (route.key !== 'inspect') {
    throw new Error(`InspectorPage requires an inspect route. Received ${route.key}.`)
  }

  const resource = useResource(docId, {
    subscribed: true,
    recursive: true,
  })
  const resourceData = (resource.data ?? undefined) as InspectorResourceData | undefined
  const inspectData = useInspectDatasets(docId, route, resourceData)
  const inspectTabs = useMemo(
    () => getInspectToolTabs(docId, route, resourceData, inspectData),
    [
      docId,
      inspectData.authoredComments.data?.comments?.length,
      inspectData.capabilities.data?.length,
      inspectData.children.data?.length,
      inspectData.changes.data?.changes?.length,
      inspectData.citations.data?.citations?.length,
      inspectData.commentVersions.data?.versions?.length,
      inspectData.comments.length,
      inspectData.contacts.data?.length,
      resourceData,
      route,
    ],
  )
  const openTarget = useMemo(() => getInspectorOpenTarget(docId, route, resourceData), [docId, resourceData, route])
  const title = useMemo(() => getInspectorTitle(docId, route, resourceData), [docId, resourceData, route])
  const toolbar = (
    <DocumentTools
      id={docId}
      mode="inspect"
      inspectRoute={route}
      inspectTabs={inspectTabs}
      rightActions={openTarget ? <InspectorOpenButton label={openTarget.label} route={openTarget.route} /> : null}
    />
  )

  if (resource.isInitialLoading) {
    return (
      <div className="flex h-full max-h-full flex-col overflow-hidden bg-zinc-100">
        <div className="flex-1 overflow-y-auto">
          <InspectorShell title={title} toolbar={toolbar}>
            <div className="flex items-center justify-center py-8">
              <Spinner />
            </div>
          </InspectorShell>
        </div>
        {pageFooter ? <div className="shrink-0">{pageFooter}</div> : null}
      </div>
    )
  }

  if (resource.isDiscovering) {
    return (
      <div className="flex h-full max-h-full flex-col overflow-hidden bg-zinc-100">
        <div className="flex-1 overflow-y-auto">
          <InspectorShell title={title} toolbar={toolbar}>
            <PageDiscovery />
          </InspectorShell>
        </div>
        {pageFooter ? <div className="shrink-0">{pageFooter}</div> : null}
      </div>
    )
  }

  return (
    <div className="flex h-full max-h-full flex-col overflow-hidden bg-zinc-100">
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto">
          <InspectorShell title={title} toolbar={toolbar}>
            <InspectorContent docId={docId} route={route} resource={resourceData} inspectData={inspectData} />
          </InspectorShell>
        </div>
        {pageFooter ? <div className="shrink-0">{pageFooter}</div> : null}
      </div>
    </div>
  )
}

function InspectorContent({
  docId,
  route,
  resource,
  inspectData,
}: {
  docId: UnpackedHypermediaId
  route: InspectRouteType
  resource: InspectorResourceData | undefined
  inspectData: ReturnType<typeof useInspectDatasets>
}) {
  const inspectTab = route.inspectTab || 'document'

  if (!resource) {
    return <PageNotFound />
  }
  if (resource.type === 'not-found') {
    return <PageNotFound />
  }
  if (resource.type === 'tombstone') {
    return <PageDeleted entityType="document" />
  }
  if (resource.type === 'error' && resource.message.toLowerCase().includes('permission')) {
    return <PagePrivate />
  }
  if (resource.type === 'error') {
    return <div className="text-destructive px-1 py-3">{resource.message}</div>
  }

  const isLoading =
    (resource.type === 'document' && inspectTab === 'changes' && inspectData.changes.isLoading) ||
    (inspectTab === 'versions' && inspectData.commentVersions.isLoading) ||
    (inspectTab === 'comments' && inspectData.commentsQuery.isLoading) ||
    (inspectTab === 'citations' && inspectData.citations.isLoading) ||
    (inspectTab === 'children' && inspectData.children.isLoading) ||
    (inspectTab === 'authored-comments' && inspectData.authoredComments.isLoading) ||
    (inspectTab === 'contacts' && inspectData.contacts.isLoading) ||
    (inspectTab === 'capabilities' && inspectData.capabilities.isLoading) ||
    (inspectTab === 'document' &&
      resource.type === 'document' &&
      route.targetView === 'comments' &&
      !!route.targetOpenComment &&
      inspectData.commentsQuery.isLoading)

  const getRouteForUrl = useCallback((url: string) => {
    if (url.startsWith('ipfs://')) {
      return createInspectIpfsNavRoute(url.slice('ipfs://'.length))
    }

    const targetRoute = hypermediaUrlToRoute(url)
    return targetRoute ? createInspectNavRouteFromRoute(targetRoute) : null
  }, [])

  const inspectPayload = useMemo(() => {
    return getInspectPayload(docId, route, resource, inspectData)
  }, [docId, inspectData, resource, route])

  const emptyMessage = getInspectEmptyMessage(resource, inspectTab, !!route.targetOpenComment)

  return (
    <div className="flex flex-col gap-4">
      {resource.type === 'redirect' ? (
        <DataViewer
          data={{type: 'redirect', redirectTarget: resource.redirectTarget}}
          getRouteForUrl={getRouteForUrl}
        />
      ) : isLoading ? (
        <div className="flex items-center justify-center py-8">
          <Spinner />
        </div>
      ) : Array.isArray(inspectPayload) && inspectPayload.length === 0 ? (
        <div className="text-muted-foreground text-sm">{emptyMessage}</div>
      ) : (
        <DataViewer data={inspectPayload} getRouteForUrl={getRouteForUrl} />
      )}
    </div>
  )
}

function InspectorOpenButton({
  label,
  route,
}: {
  label: string
  route: ReturnType<typeof createRouteFromInspectNavRoute>
}) {
  const linkProps = useRouteLink(route)

  return (
    <Button asChild size="sm" variant="outline">
      <a {...linkProps}>{label}</a>
    </Button>
  )
}

function getInspectorTitle(
  docId: UnpackedHypermediaId,
  route: InspectRouteType,
  resource: InspectorResourceData | undefined,
) {
  if (resource?.type === 'comment') {
    return packHmId(commentIdToHmId(resource.comment.id))
  }
  if (route.targetOpenComment) {
    return packHmId(commentIdToHmId(route.targetOpenComment))
  }
  return packHmId({...docId, blockRef: null, blockRange: null})
}

function useInspectDatasets(
  docId: UnpackedHypermediaId,
  route: InspectRouteType,
  resource: InspectorResourceData | undefined,
) {
  const resourceComment = resource?.type === 'comment' ? resource.comment : null
  const commentTargetId = useMemo(
    () => (resourceComment ? getCommentTargetId(resourceComment) : null),
    [resourceComment],
  )
  const commentsTargetId = resourceComment ? commentTargetId : docId
  const commentsQuery = useComments(commentsTargetId)
  const comments = useMemo(() => {
    if (!resourceComment) {
      return commentsQuery.data?.comments || []
    }
    return getReplyComments(commentsQuery.data?.comments, resourceComment.id)
  }, [commentsQuery.data?.comments, resourceComment])

  const citationsTargetId = useMemo(() => {
    if (resource?.type === 'comment') {
      return docId
    }
    if (route.targetView === 'comments' && route.targetOpenComment) {
      return commentIdToHmId(route.targetOpenComment)
    }
    return docId
  }, [docId, resource?.type, route.targetOpenComment, route.targetView])

  return {
    authoredComments: useAuthoredComments(docId),
    capabilities: useCapabilities(docId),
    changes: useChanges(resource?.type === 'document' ? docId : null),
    children: useChildrenList(docId),
    citations: useCitations(resource?.type === 'document' || resource?.type === 'comment' ? citationsTargetId : null),
    commentTargetId,
    comments,
    commentsQuery,
    commentVersions: useCommentVersions(
      resourceComment ? resourceComment.id : route.targetView === 'comments' ? route.targetOpenComment : null,
    ),
    contacts: useContactListOfSubject(docId.uid),
  }
}

function getInspectToolTabs(
  docId: UnpackedHypermediaId,
  route: InspectRouteType,
  resource: InspectorResourceData | undefined,
  inspectData: ReturnType<typeof useInspectDatasets>,
) {
  const isHomeDoc = !docId.path?.filter(Boolean).length
  const isComment = resource?.type === 'comment'
  const tabs: {
    tab: InspectTab
    label: string
    tooltip: string
    icon: LucideIcon
    count?: number
  }[] = [
    {
      tab: 'document',
      label: isComment ? 'Comment' : 'Document',
      tooltip: isComment ? 'Inspect comment state' : 'Inspect document state',
      icon: FileText,
    },
  ]

  if (resource?.type === 'document') {
    tabs.push({
      tab: 'changes',
      label: 'Changes',
      tooltip: 'Inspect document changes',
      icon: History,
      count: inspectData.changes.data?.changes?.length,
    })
  }

  if (isComment || route.targetOpenComment) {
    tabs.push({
      tab: 'versions',
      label: 'Versions',
      tooltip: 'Inspect comment versions',
      icon: History,
      count: inspectData.commentVersions.data?.versions?.length,
    })
  }

  tabs.push(
    {
      tab: 'comments',
      label: 'Comments',
      tooltip: 'Inspect comments',
      icon: MessageSquare,
      count: inspectData.comments.length,
    },
    {
      tab: 'citations',
      label: 'Citations',
      tooltip: 'Inspect citations',
      icon: Quote,
      count: inspectData.citations.data?.citations?.length,
    },
    {
      tab: 'children',
      label: 'Children',
      tooltip: 'Inspect child documents',
      icon: Folder,
      count: inspectData.children.data?.length,
    },
  )

  if (isHomeDoc) {
    tabs.push({
      tab: 'authored-comments',
      label: 'Authored',
      tooltip: 'Inspect authored comments',
      icon: MessagesSquare,
      count: inspectData.authoredComments.data?.comments?.length,
    })
  }

  tabs.push(
    {
      tab: 'contacts',
      label: 'Contacts',
      tooltip: 'Inspect site contacts',
      icon: Users,
      count: inspectData.contacts.data?.length,
    },
    {
      tab: 'capabilities',
      label: 'Capabilities',
      tooltip: 'Inspect capabilities',
      icon: Shield,
      count: inspectData.capabilities.data?.length,
    },
  )

  return tabs
}

function getInspectPayload(
  docId: UnpackedHypermediaId,
  route: InspectRouteType,
  resource: InspectorResourceData,
  inspectData: ReturnType<typeof useInspectDatasets>,
) {
  const inspectTab = route.inspectTab || 'document'

  if (resource.type === 'comment') {
    switch (inspectTab) {
      case 'versions':
        return prepareInspectCommentVersionsData(inspectData.commentVersions.data?.versions)
      case 'comments':
        return prepareInspectCommentsData(inspectData.comments)
      case 'citations':
        return prepareInspectCitationsData(inspectData.citations.data?.citations)
      case 'children':
        return prepareInspectChildrenData(inspectData.children.data)
      case 'authored-comments':
        return prepareInspectCommentsData(inspectData.authoredComments.data?.comments)
      case 'contacts':
        return prepareInspectContactsData(inspectData.contacts.data)
      case 'capabilities':
        return prepareInspectCapabilitiesData(inspectData.capabilities.data)
      default:
        return prepareInspectCommentData(resource.comment as unknown as Record<string, any>)
    }
  }

  if (resource.type === 'document') {
    switch (inspectTab) {
      case 'changes':
        return prepareInspectChangesData(inspectData.changes.data?.changes, docId)
      case 'versions':
        return prepareInspectCommentVersionsData(inspectData.commentVersions.data?.versions)
      case 'comments':
        return prepareInspectCommentsData(inspectData.comments)
      case 'citations':
        return prepareInspectCitationsData(inspectData.citations.data?.citations)
      case 'children':
        return prepareInspectChildrenData(inspectData.children.data)
      case 'authored-comments':
        return prepareInspectCommentsData(inspectData.authoredComments.data?.comments)
      case 'contacts':
        return prepareInspectContactsData(inspectData.contacts.data)
      case 'capabilities':
        return prepareInspectCapabilitiesData(inspectData.capabilities.data)
      default:
        return route.targetView === 'comments' && route.targetOpenComment
          ? prepareInspectCommentData(
              inspectData.comments.find((comment) => comment.id === route.targetOpenComment) ?? null,
            )
          : prepareInspectDocumentData(resource.document, docId)
    }
  }

  if (resource.type === 'redirect') {
    return {type: 'redirect', redirectTarget: resource.redirectTarget}
  }

  return {type: resource.type}
}

function getInspectEmptyMessage(
  resource: InspectorResourceData,
  inspectTab: InspectTab | 'document',
  hasTargetComment?: boolean,
) {
  if (resource.type === 'comment' && inspectTab === 'document') {
    return 'No comment data found.'
  }

  switch (inspectTab) {
    case 'changes':
      return 'No changes found.'
    case 'versions':
      return 'No comment versions found.'
    case 'comments':
      return 'No comments found.'
    case 'citations':
      return 'No citations found.'
    case 'children':
      return 'No child documents found.'
    case 'authored-comments':
      return 'No authored comments found.'
    case 'contacts':
      return 'No contacts found.'
    case 'capabilities':
      return 'No capabilities found.'
    default:
      return hasTargetComment ? 'No comment data found.' : 'No document data found.'
  }
}

function getInspectorOpenTarget(
  docId: UnpackedHypermediaId,
  route: InspectRouteType,
  resource: InspectorResourceData | undefined,
) {
  if (resource?.type === 'comment') {
    const targetDocId = getCommentTargetId(resource.comment)
    return {
      label: 'Open Comment',
      route: targetDocId
        ? ({
            key: 'comments',
            id: targetDocId,
            openComment: resource.comment.id,
            panel: null,
          } as const)
        : ({key: 'document', id: docId, panel: null} as const),
    }
  }

  const openRoute = createRouteFromInspectNavRoute(route, route.inspectTab)

  if (route.inspectTab === 'changes') {
    return {label: 'Open Document Versions', route: openRoute}
  }
  if (route.inspectTab === 'citations') {
    return {label: 'Open Document Citations', route: openRoute}
  }
  if (route.inspectTab === 'comments') {
    return {label: route.targetOpenComment ? 'Open Comment' : 'Open Document Comments', route: openRoute}
  }
  if (route.inspectTab === 'versions') {
    return {label: 'Open Comment', route: openRoute}
  }
  if (route.inspectTab === 'children') {
    return {label: 'Open Directory', route: openRoute}
  }
  switch (route.targetView) {
    case 'activity':
      return {
        label:
          activityFilterToSlug(route.targetActivityFilter) === 'citations'
            ? 'Open Document Citations'
            : 'Open Document Activity',
        route: openRoute,
      }
    case 'comments':
      return {label: route.targetOpenComment ? 'Open Comment' : 'Open Document Comments', route: openRoute}
    case 'directory':
      return {label: 'Open Directory', route: openRoute}
    case 'collaborators':
      return {label: 'Open People', route: openRoute}
    case 'feed':
      return {label: 'Open Feed', route: openRoute}
    case 'profile':
      return {label: 'Open Profile', route: openRoute}
    case 'membership':
      return {label: 'Open Membership', route: openRoute}
    case 'followers':
      return {label: 'Open Followers', route: openRoute}
    case 'following':
      return {label: 'Open Following', route: openRoute}
    default:
      return {label: 'Open Document', route: openRoute}
  }
}

function prepareInspectDocumentData(document: HMDocument, docId: UnpackedHypermediaId) {
  const {metadata, account, authors, genesis, version, content, ...rest} = document
  const preparedData: Record<string, unknown> = {...metadata, ...rest}

  if (account) {
    preparedData.account = `hm://${account}`
  }
  if (authors) {
    preparedData.authors = authors.map((author) => `hm://${author}`)
  }
  if (version) {
    preparedData.version = version.split('.').map((changeCid) => `ipfs://${changeCid}`)
    preparedData.exactDocumentVersion = packHmId({...docId, version, latest: null, blockRef: null, blockRange: null})
  }
  if (genesis) {
    preparedData.genesis = `ipfs://${genesis}`
  }
  if (content) {
    preparedData.content = content.map(flattenInspectBlockNode)
  }

  return flattenSingleItemArrays(preparedData)
}

function prepareInspectCommentData(comment: Record<string, any> | null) {
  if (!comment) return null

  const {id, author, targetPath, targetAccount, targetVersion, ...rest} = comment
  const preparedComment: Record<string, unknown> = {...rest}

  if (id) {
    preparedComment.id = packHmId(commentIdToHmId(id, typeof rest.version === 'string' ? rest.version : undefined))
  }
  if (author) {
    preparedComment.author = `hm://${author}`
  }
  if (targetAccount) {
    preparedComment.target = packHmId(
      hmId(targetAccount, {
        path: entityQueryPathToHmIdPath(targetPath || ''),
        version: targetVersion,
      }),
    )
  }

  return preparedComment
}

function prepareInspectCommentsData(comments: unknown[] | undefined) {
  return (comments || [])
    .map((comment) => prepareInspectCommentData((comment || null) as Record<string, any> | null))
    .filter((comment): comment is Record<string, unknown> => comment !== null)
}

function prepareInspectContactsData(contacts: HMContactRecord[] | undefined) {
  return (contacts || []).map((contact) => ({
    ...contact,
    subject: `hm://${contact.subject}`,
    account: `hm://${contact.account}`,
    signer: `hm://${contact.signer}`,
  }))
}

function prepareInspectCapabilitiesData(capabilities: HMCapability[] | undefined) {
  return (capabilities || []).map((capability) => {
    const {id, accountUid, grantId, ...rest} = capability
    return {
      ...rest,
      id: id === '_owner' ? id : `ipfs://${id}`,
      accountUid: `hm://${accountUid}`,
      grantId: grantId.id,
    }
  })
}

function prepareInspectChangesData(changes: unknown[] | undefined, docId: UnpackedHypermediaId) {
  return (changes || []).map((change) => {
    const typedChange = (change || {}) as Record<string, any>
    const {id, author, deps, ...rest} = typedChange
    const preparedChange: Record<string, unknown> = {...rest}

    if (author) {
      preparedChange.author = `hm://${author}`
    }
    if (id) {
      preparedChange.id = `ipfs://${id}`
      preparedChange.version = packHmId({...docId, version: id, latest: null, blockRef: null, blockRange: null})
    }
    if (Array.isArray(deps)) {
      preparedChange.deps = deps.map((dep: string) => `ipfs://${dep}`)
    }

    return preparedChange
  })
}

function prepareInspectCitationsData(citations: unknown[] | undefined) {
  return (citations || []).map((citation) => {
    const typedCitation = (citation || {}) as Record<string, any>
    const {sourceBlob, ...rest} = typedCitation
    if (!sourceBlob) return rest

    const {cid, author, ...sourceRest} = sourceBlob
    return {
      ...rest,
      sourceBlob: {
        id: cid ? `ipfs://${cid}` : null,
        author: author ? `hm://${author}` : null,
        ...sourceRest,
      },
    }
  })
}

function prepareInspectChildrenData(children: unknown[] | undefined) {
  return (children || []).map((child) => {
    const typedChild = (child || {}) as Record<string, any>
    return {
      ...typedChild,
      id: typedChild.id ? packHmId(typedChild.id) : typedChild.id,
    }
  })
}

function prepareInspectCommentVersionsData(versions: Record<string, any>[] | undefined) {
  return (versions || []).map((version) => {
    const preparedVersion: Record<string, unknown> = {...version}

    if (version.author) {
      preparedVersion.author = `hm://${version.author}`
    }
    if (version.id && version.version) {
      preparedVersion.exactVersion = packHmId(commentIdToHmId(version.id, version.version))
    }

    return preparedVersion
  })
}

function flattenInspectBlockNode(node: HMBlockNode) {
  const {block, children} = node
  const preparedBlock: Record<string, unknown> = {...block}

  if (children?.length) {
    preparedBlock.children = children.map(flattenInspectBlockNode)
  }

  return preparedBlock
}

function flattenSingleItemArrays(value: unknown): unknown {
  if (Array.isArray(value)) {
    const flattenedArray = value.map((item) => flattenSingleItemArrays(item))
    return flattenedArray.length === 1 ? flattenedArray[0] : flattenedArray
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, itemValue]) => {
        return [key, flattenSingleItemArrays(itemValue)]
      }),
    )
  }

  return value
}

function getReplyComments(comments: HMComment[] | undefined, commentId: string | null | undefined): HMComment[] {
  if (!Array.isArray(comments) || !commentId) {
    return []
  }

  const descendantIds = new Set<string>()
  let foundNewReply = true

  while (foundNewReply) {
    foundNewReply = false

    comments.forEach((comment) => {
      if (!comment.replyParent || descendantIds.has(comment.id)) {
        return
      }
      if (comment.replyParent === commentId || descendantIds.has(comment.replyParent)) {
        descendantIds.add(comment.id)
        foundNewReply = true
      }
    })
  }

  return comments.filter((comment) => descendantIds.has(comment.id))
}
