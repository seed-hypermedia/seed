import {Shield} from 'lucide-react'
import React, {useMemo} from 'react'
import {useNavigate} from 'react-router-dom'
import DataViewer from '../DataViewer'
import EmptyState from '../EmptyState'

interface CapabilitiesTabProps {
  capabilities?: any[]
}

const CapabilitiesTab: React.FC<CapabilitiesTabProps> = ({capabilities}) => {
  const navigate = useNavigate()
  const preparedCapabilities = useMemo(() => {
    // Ensure capabilities is an array before mapping
    if (!Array.isArray(capabilities)) {
      console.warn('Capabilities is not an array:', capabilities)
      return []
    }
    return capabilities.map((capability) => {
      const {id, issuer, delegate, account, ...rest} = capability
      const out = {...rest}
      if (id) {
        out.id = `ipfs://${id}`
      }
      if (issuer) {
        out.issuer = `hm://${issuer}`
      }
      if (delegate) {
        out.delegate = `hm://${delegate}`
      }
      if (account) {
        out.account = `hm://${account}`
      }
      return out
    })
  }, [capabilities])

  // Handle case where there are no capabilities
  if (!Array.isArray(capabilities) || capabilities.length === 0) {
    return <EmptyState message="No capabilities available" icon={Shield} />
  }

  return (
    <div className="flex flex-col gap-4">
      {preparedCapabilities.map((capability) => (
        <div key={capability.id}>
          <DataViewer data={capability} onNavigate={navigate} />
        </div>
      ))}
    </div>
  )
}

export default CapabilitiesTab
