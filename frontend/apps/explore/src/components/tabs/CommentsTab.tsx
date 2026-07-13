import {commentIdToHmId, entityQueryPathToHmIdPath, hmId, packHmId} from '@shm/shared'
import {MessageCircle} from 'lucide-react'
import React, {useMemo} from 'react'
import {useHmNavigate} from '../../utils/useHmNavigate'
import DataViewer from '../DataViewer'
import EmptyState from '../EmptyState'

const CommentsTab: React.FC<{comments: any[] | undefined; emptyMessage?: string}> = ({
  comments,
  emptyMessage = 'No comments available',
}) => {
  const navigate = useHmNavigate()
  const preparedComments = useMemo(() => {
    if (!Array.isArray(comments)) {
      console.warn('Comments is not an array:', comments)
      return []
    }
    return comments.map((comment) => {
      const {id, author, targetPath, targetAccount, targetVersion, ...rest} = comment
      const out: Record<string, any> = {...rest}
      if (id) {
        out.id = packHmId(commentIdToHmId(id, typeof rest.version === 'string' ? rest.version : undefined))
      }
      if (author) {
        out.author = `hm://${author}`
      }
      if (targetAccount) {
        out.target = packHmId(
          hmId(targetAccount, {
            path: entityQueryPathToHmIdPath(targetPath || ''),
            version: targetVersion,
          }),
        )
      }
      return out
    })
  }, [comments])

  if (!Array.isArray(comments) || comments.length === 0) {
    return <EmptyState message={emptyMessage} icon={MessageCircle} />
  }

  return (
    <div className="flex flex-col gap-4">
      {preparedComments.map((comment) => (
        <div key={comment.id}>
          <DataViewer data={comment} onNavigate={navigate} />
        </div>
      ))}
    </div>
  )
}

export default CommentsTab
