import {UserCircle} from 'lucide-react'
import React from 'react'
import {DataViewer} from '../DataViewer'
import EmptyState from '../EmptyState'

interface ProfileTabProps {
  /** The account home document's metadata — its profile fields (name, icon, …). */
  metadata: Record<string, any> | undefined
  onNavigate: (url: string) => void
}

/** Renders an account's profile (its home document metadata), distinct from the raw Document State. */
const ProfileTab: React.FC<ProfileTabProps> = ({metadata, onNavigate}) => {
  if (!metadata || Object.keys(metadata).length === 0) {
    return <EmptyState message="This account has no profile metadata" icon={UserCircle} />
  }
  return <DataViewer data={metadata} onNavigate={onNavigate} />
}

export default ProfileTab
