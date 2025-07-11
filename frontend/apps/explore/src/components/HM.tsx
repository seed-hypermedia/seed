import {
  HMBlockNode,
  hmId,
  hmIdPathToEntityQueryPath,
  packHmId,
} from '@shm/shared'
import {useMemo} from 'react'
import {useNavigate, useParams, useSearchParams} from 'react-router-dom'
import {useApiHost} from '../apiHostStore'
import {
  useAuthoredComments,
  useCapabilities,
  useChanges,
  useChildrenList,
  useCitations,
  useComments,
  useResource,
} from '../models'
import {CopyTextButton} from './CopyTextButton'
import {ExternalOpenButton, OpenInAppButton} from './ExternalOpenButton'
import Tabs, {TabType} from './Tabs'
import AuthoredCommentsTab from './tabs/AuthoredCommentsTab'
import CapabilitiesTab from './tabs/CapabilitiesTab'
import ChangesTab from './tabs/ChangesTab'
import {ChildrenDocsTab} from './tabs/ChildrenDocsTab'
import CitationsTab from './tabs/CitationsTab'
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
  const {data, isLoading} = useResource(id)
  const {data: comments, isLoading: commentsLoading} = useComments(id)
  const {data: authoredComments, isLoading: authoredCommentsLoading} =
    useAuthoredComments(id)
  const {data: citations, isLoading: citationsLoading} = useCitations(id)
  const {data: changes, isLoading: changesLoading} = useChanges(id)
  const {data: capabilities, isLoading: capabilitiesLoading} =
    useCapabilities(id)
  const {data: childrenDocsUnfiltered, isLoading: childrenLoading} =
    useChildrenList(id)
  const childrenDocs = useMemo(() => {
    return childrenDocsUnfiltered?.documents?.filter(
      (doc) => doc.id.id.startsWith(id.id) && doc.id.id !== id.id,
    )
  }, [childrenDocsUnfiltered, id])

  const url = packHmId(id)

  // Get current tab from URL or default to "document"
  const currentTab = (searchParams.get('tab') as TabType) || 'document'

  // Function to change tabs
  const handleTabChange = (tab: TabType) => {
    setSearchParams({tab})
  }

  const preparedData = useMemo(() => {
    if (!data) return null
    const {
      metadata,
      account,
      authors,
      genesis,
      generationInfo,
      version,
      content,
      ...rest
    } = data
    const cleaned = {...metadata, ...rest}
    if (account) {
      cleaned.account = `hm://${account}`
    }
    if (authors) {
      cleaned.authors = authors.map((author: string) => `hm://${author}`)
    }
    if (version) {
      cleaned.version = version
        .split('.')
        .map((changeCid: string) => `ipfs://${changeCid}`)
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

    // old comment type
    // if (type === 'c') {
    //   const {id, author, targetPath, targetAccount, targetVersion, ...rest} =
    //     data
    //   const cleaned = {...rest}
    //   if (id) {
    //     cleaned.id = `ipfs://${id}`
    //   }
    //   if (author) {
    //     cleaned.author = `hm://${author}`
    //   }
    //   if (targetAccount) {
    //     cleaned.target = packHmId(
    //       hmId(targetAccount, {
    //         path: entityQueryPathToHmIdPath(targetPath || ''),
    //         version: targetVersion,
    //       }),
    //     )
    //   }
    //   return flattenSingleItemArrays(cleaned)
    // }
    return null
  }, [data])

  // Render tab content based on current tab
  const renderTabContent = () => {
    switch (currentTab) {
      case 'document':
        return <DocumentTab data={preparedData} onNavigate={navigate} />
      case 'changes':
        return <ChangesTab changes={changes?.changes} docId={id} />
      case 'comments':
        return <CommentsTab comments={comments?.comments} />
      case 'citations':
        return <CitationsTab citations={citations?.citations} />
      case 'capabilities':
        return <CapabilitiesTab capabilities={capabilities?.capabilities} />
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
    <div className="container overflow-hidden p-4 mx-auto max-w-full">
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
        currentTab={currentTab}
        onTabChange={handleTabChange}
        changeCount={changes?.changes?.length}
        commentCount={comments?.comments?.length}
        citationCount={citations?.citations?.length}
        capabilityCount={capabilities?.capabilities?.length}
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
