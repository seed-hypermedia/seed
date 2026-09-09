import {registerWebAgentsPlatform} from '@/web-agents-platform'
import {useSelectedAccountId} from '@shm/ui/agents/account'
import {AgentActivityLiveUpdates, useAgentActivityIndicator} from '@shm/ui/agents/activity'
import type {AgentActivityIndicator} from '@shm/ui/agents/activity-dot'
import {useAgentServerUrls} from '@shm/ui/agents/models'
import {useEffect} from 'react'

registerWebAgentsPlatform()

/**
 * Tracks recent agent activity for the site header's unread dot. Keeps one account socket per
 * agents server open (so hints arrive with the panel closed) and reports the resolved indicator
 * up to the assistant host, which hands it to the header through the toggle context.
 */
export default function WebAssistantActivity({
  onChange,
}: {
  onChange: (indicator: AgentActivityIndicator | null) => void
}) {
  const accountUid = useSelectedAccountId()
  const serverUrls = useAgentServerUrls()
  const indicator = useAgentActivityIndicator(serverUrls.data, accountUid)
  useEffect(() => {
    onChange(indicator)
  }, [indicator, onChange])
  return <AgentActivityLiveUpdates serverUrls={serverUrls.data} accountUid={accountUid} />
}
