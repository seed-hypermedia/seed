import {Quote} from 'lucide-react'
import React, {useMemo} from 'react'
import {useNavigate} from 'react-router-dom'
import DataViewer from '../DataViewer'
import EmptyState from '../EmptyState'

const CitationsTab: React.FC<{citations: any[]}> = ({citations}) => {
  const navigate = useNavigate()
  const preparedCitations = useMemo(() => {
    if (!Array.isArray(citations)) {
      console.warn('Citations is not an array:', citations)
      return []
    }
    return citations.map((citation) => {
      const {sourceBlob, ...rest} = citation
      const out = {...rest}
      if (sourceBlob) {
        const {cid, author, ...rest} = sourceBlob
        out.sourceBlob = {
          id: `ipfs://${cid}`,
          author: `hm://${author}`,
          ...rest,
        }
      }
      return out
    })
  }, [citations])

  if (!Array.isArray(citations) || citations.length === 0) {
    return <EmptyState message="No citations available" icon={Quote} />
  }

  return (
    <div className="flex flex-col gap-4">
      {preparedCitations.map((citation) => (
        <div key={citation.id}>
          <DataViewer data={citation} onNavigate={navigate} />
        </div>
      ))}
    </div>
  )
}

export default CitationsTab
