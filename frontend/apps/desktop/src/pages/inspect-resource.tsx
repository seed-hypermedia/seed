import {useResource} from '@shm/graphql'
import {useNavRoute} from '@shm/shared/utils/navigation'

export default function InspectResourcePage() {
  const route = useNavRoute()
  if (route.key !== 'inspect-resource') {
    throw new Error('Invalid route for inspect resource page')
  }
  const iri = route.id.id
  const result = useResource(iri)

  if (result.fetching) {
    return <div className="p-4">Loading resource...</div>
  }

  if (result.error) {
    return (
      <div className="p-4 text-red-600">
        Error loading resource: {result.error.message}
      </div>
    )
  }

  const resource = result.data?.getResource

  if (!resource) {
    return <div className="p-4">Resource not found</div>
  }

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Resource Inspector</h1>
      <div className="space-y-2">
        <div>
          <strong>Type:</strong> {resource.__typename}
        </div>
        <div>
          <strong>IRI:</strong> {resource.iri}
        </div>
        <div>
          <strong>Version:</strong> {resource.version || 'Latest'}
        </div>
        {resource.__typename === 'Document' && (
          <>
            <div>
              <strong>Account:</strong> {resource.account}
            </div>
            <div>
              <strong>Path:</strong> {resource.path}
            </div>
            <div>
              <strong>Name:</strong> {resource.name}
            </div>
            <div className="mt-4">
              <strong>Content:</strong>
              <div className="mt-2 space-y-1">
                <div>Blocks: {resource.content.blocks.length}</div>
                <div>Root blocks: {resource.content.rootBlockIds.length}</div>
              </div>
            </div>
          </>
        )}
        {resource.__typename === 'Comment' && (
          <>
            <div>
              <strong>Comment ID:</strong> {resource.id}
            </div>
            <div>
              <strong>Author ID:</strong> {resource.authorId}
            </div>
            <div>
              <strong>Author Name:</strong> {resource.author.name || 'Unknown'}
            </div>
            <div>
              <strong>Target:</strong> {resource.targetAccount}/{resource.targetPath}
            </div>
            {resource.replyParent && (
              <div>
                <strong>Reply to:</strong> {resource.replyParent}
              </div>
            )}
          </>
        )}
        <div className="mt-4">
          <strong>Raw Data:</strong>
          <pre className="mt-2 p-2 bg-gray-100 dark:bg-gray-800 rounded overflow-auto max-h-96">
            {JSON.stringify(resource, null, 2)}
          </pre>
        </div>
      </div>
    </div>
  )
}
