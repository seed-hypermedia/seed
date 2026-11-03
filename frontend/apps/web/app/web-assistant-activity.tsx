import {registerWebAgentsPlatform} from '@/web-agents-platform'
import {useSelectedAccountId} from '@shm/ui/agents/account'
import {AgentActivityLiveUpdates, useSiteAgentActivityIndicator} from '@shm/ui/agents/activity'
import type {AgentActivityIndicator} from '@shm/ui/agents/activity-dot'
import {useMountedSiteAgents} from '@shm/ui/agents/models'
import {useEffect, useMemo} from 'react'

registerWebAgentsPlatform()

/**
 * Watches the agents mounted in this site on behalf of the signed-in account, for the site header.
 *
 * Two things come out of it. Whether the account can use any of the site's agents at all: each
 * mount is fetched by id, which the server answers for the owner, an accepted collaborator, or
 * any signed account once the agent is public, so a mount document alone proves nothing and a
 * reader the agents are not shared with gets no entry point. And the recent-activity indicator
 * for the header's unread dot, kept current by one account socket per server those agents live
 * on (so hints arrive with the panel closed). Both are reported up to the assistant host, which
 * hands them to the header through the toggle context. No server a mount document does not name
 * is contacted.
 */
export default function WebAssistantActivity({
  onChange,
  onAgentsChange,
}: {
  onChange: (indicator: AgentActivityIndicator | null) => void
  /** Whether the signed-in account can see at least one agent mounted in the site on screen. */
  onAgentsChange: (hasAgents: boolean) => void
}) {
  const accountUid = useSelectedAccountId()
  const site = useMountedSiteAgents(accountUid)
  const serverUrls = useMemo(() => Array.from(new Set(site.agents.map((entry) => entry.serverUrl))), [site.agents])
  const hasAgents = site.agents.length > 0
  useEffect(() => {
    onAgentsChange(hasAgents)
  }, [hasAgents, onAgentsChange])
  const indicator = useSiteAgentActivityIndicator(accountUid)
  useEffect(() => {
    onChange(indicator)
  }, [indicator, onChange])
  return <AgentActivityLiveUpdates serverUrls={serverUrls} accountUid={accountUid} />
}
