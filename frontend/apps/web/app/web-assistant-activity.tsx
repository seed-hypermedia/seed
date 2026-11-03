import {registerWebAgentsPlatform} from '@/web-agents-platform'
import {useSelectedAccountId} from '@shm/ui/agents/account'
import {AgentActivityLiveUpdates, useSiteAgentActivityIndicator} from '@shm/ui/agents/activity'
import type {AgentActivityIndicator} from '@shm/ui/agents/activity-dot'
import {useMountedSiteAgents} from '@shm/ui/agents/models'
import {useEffect, useMemo} from 'react'

registerWebAgentsPlatform()

/**
 * Tracks recent agent activity for the site header's unread dot, over the agents mounted in this
 * site. Keeps one account socket open per server those agents live on (so hints arrive with the
 * panel closed) and reports the resolved indicator up to the assistant host, which hands it to
 * the header through the toggle context. No server a mount document does not name is contacted.
 */
export default function WebAssistantActivity({
  onChange,
}: {
  onChange: (indicator: AgentActivityIndicator | null) => void
}) {
  const accountUid = useSelectedAccountId()
  const site = useMountedSiteAgents(accountUid)
  const serverUrls = useMemo(() => Array.from(new Set(site.agents.map((entry) => entry.serverUrl))), [site.agents])
  const indicator = useSiteAgentActivityIndicator(accountUid)
  useEffect(() => {
    onChange(indicator)
  }, [indicator, onChange])
  return <AgentActivityLiveUpdates serverUrls={serverUrls} accountUid={accountUid} />
}
