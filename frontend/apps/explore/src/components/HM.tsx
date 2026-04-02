import {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import {
  hmId,
  hmIdPathToEntityQueryPath,
  packHmId,
  useAuthoredComments,
  useCapabilities,
  useChanges,
  useChildrenList,
  useCitations,
  useComments,
  useCommentVersions,
  useResource,
} from '@shm/shared'
import {useMemo} from 'react'
import {useNavigate, useParams, useSearchParams} from 'react-router-dom'
import {useApiHost} from '../apiHostStore'
import {CopyTextButton} from './CopyTextButton'
import {ExternalOpenButton, OpenInAppButton} from './ExternalOpenButton'
import Tabs, {getSafeCurrentTab, getTabSearchParams, getTabs, TabType} from './Tabs'
import AuthoredCommentsTab from './tabs/AuthoredCommentsTab'
import CapabilitiesTab from './tabs/CapabilitiesTab'
import ChangesTab from './tabs/ChangesTab'
import {ChildrenDocsTab} from './tabs/ChildrenDocsTab'
import CitationsTab from './tabs/CitationsTab'
import CommentVersionsTab from './tabs/CommentVersionsTab'
import CommentsTab from './tabs/CommentsTab'
import DocumentTab from './tabs/DocumentTab'
import {Title} from './Title'

export default function HM() {
  const {'*': path} = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const pathParts = path ? path.split('/') : []
  const uid = pathParts[0]
  const hmPath = pathParts.slice(1)

  const apiHost = useApiHost()
  const navigate = useNavigate()
  const id = hmId(uid, {
    path: hmPath,
    version: searchParams.get('v') ? searchParams.get('v') : undefined,
  })
  const {data} = useResource(id)
  const resourceType = data?.type
  const {data: comments} = useComments(id)
  const {data: authoredComments} = useAuthoredComments(id)
  const {data: citations} = useCitations(resourceType === 'document' ? id : null)
  const {data: changes} = useChanges(resourceType === 'document' ? id : null)
  const commentId = data?.type === 'comment' ? data.comment.id : null
  const {data: commentVersions} = useCommentVersions(commentId)
  const {data: capabilities} = useCapabilities(id)
  const {data: childrenDocs} = useChildrenList(id)

  const url = packHmId(id)

  const tabs = useMemo(
    () =>
      getTabs({
        id,
        resourceType,
        changeCount: changes?.changes?.length,
        versionCount: commentVersions?.versions?.length,
        commentCount: comments?.comments?.length,
        citationCount: citations?.citations?.length,
        capabilityCount: capabilities?.length,
        childrenCount: childrenDocs?.length,
        authoredCommentCount: authoredComments?.comments?.length,
      }),
    [
      authoredComments?.comments?.length,
      capabilities?.length,
      changes?.changes?.length,
      childrenDocs?.length,
      citations?.citations?.length,
      commentVersions?.versions?.length,
      comments?.comments?.length,
      id,
      resourceType,
    ],
  )

  // Get current tab from URL or default to "document"
  const currentTab = getSafeCurrentTab(searchParams.get('tab'), tabs)

  // Function to change tabs
  const handleTabChange = (tab: TabType) => {
    setSearchParams(getTabSearchParams(searchParams, tab))
  }

  const preparedData = useMemo(() => {
    if (!data) return null

    // Handle different resource types
    if (data.type === 'document') {
      const doc = data.document
      const {metadata, account, authors, genesis, version, content, ...rest} = doc
      const cleaned: Record<string, any> = {...metadata, ...rest}
      if (account) {
        cleaned.account = `hm://${account}`
      }
      if (authors) {
        cleaned.authors = authors.map((author: string) => `hm://${author}`)
      }
      if (version) {
        cleaned.version = version.split('.').map((changeCid: string) => `ipfs://${changeCid}`)
        cleaned.exactDocumentVersion = packHmId({
          ...id,
          version: version,
        })
      }
      if (genesis) {
        cleaned.genesis = `ipfs://${genesis}`
      }
      if (content) {
        cleaned.content = content.map(flattenBlockNode)
      }
      return flattenSingleItemArrays(cleaned)
    }

    if (data.type === 'comment') {
      return {type: 'comment', comment: data.comment}
    }

    if (data.type === 'redirect') {
      return {type: 'redirect', redirectTarget: data.redirectTarget}
    }

    if (data.type === 'not-found') {
      return {type: 'not-found'}
    }

    if (data.type === 'tombstone') {
      return {type: 'tombstone'}
    }

    return null
  }, [data, id])

  // Render tab content based on current tab
  const renderTabContent = () => {
    switch (currentTab) {
      case 'document':
        return <DocumentTab data={preparedData} onNavigate={navigate} />
      case 'changes':
        return <ChangesTab changes={changes?.changes} docId={id} />
      case 'versions':
        return <CommentVersionsTab versions={commentVersions?.versions} />
      case 'comments':
        return <CommentsTab comments={comments?.comments} />
      case 'citations':
        return <CitationsTab citations={citations?.citations} />
      case 'capabilities':
        return <CapabilitiesTab capabilities={capabilities} />
      case 'children':
        return <ChildrenDocsTab list={childrenDocs} id={id} />
      case 'authored-comments':
        return <AuthoredCommentsTab comments={authoredComments?.comments} />
      default:
        return null
    }
  }

  let webUrl = `${apiHost}/hm/${id.uid}${hmIdPathToEntityQueryPath(id.path)}`
  if (id.version) {
    webUrl += `?v=${id.version}`
  }

  return (
    <div className="container mx-auto max-w-full overflow-hidden p-4">
      <Title
        className="mb-4"
        buttons={
          <>
            <CopyTextButton text={url} />
            <ExternalOpenButton url={webUrl} />
            <OpenInAppButton url={url} />
          </>
        }
        title={url}
      />

      <Tabs
        id={id}
        resourceType={resourceType}
        currentTab={currentTab}
        onTabChange={handleTabChange}
        changeCount={changes?.changes?.length}
        versionCount={commentVersions?.versions?.length}
        commentCount={comments?.comments?.length}
        citationCount={citations?.citations?.length}
        capabilityCount={capabilities?.length}
        childrenCount={childrenDocs?.length}
        authoredCommentCount={authoredComments?.comments?.length}
      />
      <div className="tab-content">{renderTabContent()}</div>
    </div>
  )
}

function flattenBlockNode(node: HMBlockNode) {
  const {block, children} = node
  const out = {...block}
  if (children && Array.isArray(children)) {
    // @ts-ignore - Adding children property to the block
    out.children = children.map(flattenBlockNode)
  }
  return out
}

function flattenSingleItemArrays(obj: any): any {
  for (const key in obj) {
    if (Array.isArray(obj[key])) {
      if (obj[key].length === 1) {
        obj[key] = obj[key][0]
      } else {
        obj[key] = obj[key].map(flattenSingleItemArrays)
      }
    } else if (typeof obj[key] === 'object' && obj[key] !== null) {
      obj[key] = flattenSingleItemArrays(obj[key])
    }
  }
  return obj
}
