import {registerWebAgentsPlatform} from '@/web-agents-platform'
import {useSelectedAccountId} from '@shm/ui/agents/account'
import {AgentActivityLiveUpdates, useSiteAgentReadBaseline} from '@shm/ui/agents/activity'
import {useMountedSiteAgents, useOrphanAgents} from '@shm/ui/agents/models'
import {useEffect, useMemo} from 'react'

registerWebAgentsPlatform()

/** What the site header needs to know about the signed-in account's agents here. */
export type WebAssistantAgents = {
  /** Whether the account can see at least one agent mounted in the site on screen. */
  usable: boolean
  /** How many agents the account owns that live in no space yet, so the header can flag them. */
  orphans: number
}

/**
 * Watches the agents of this site on behalf of the signed-in account, for the site header.
 *
 * Two things come out of it. Whether the account can use any of the site's mounted agents: each
 * mount is fetched by id, which the server answers for the owner, an accepted collaborator, or
 * any signed account once the agent is public, so a mount document alone proves nothing and a
 * reader the agents are not shared with gets no entry point. Whether the account owns orphan
 * agents (from before agents were documents, on the deployment's server or on the servers the
 * mounts name), since the entry point is the only place they can be discovered and adopted. Both
 * are reported up to the assistant host, which hands them to the header through the toggle
 * context. It also keeps one account socket per server the mounted agents live on, so the agent
 * lists stay current while the panel is closed.
 */
export default function WebAssistantActivity({onAgentsChange}: {onAgentsChange: (agents: WebAssistantAgents) => void}) {
  const accountUid = useSelectedAccountId()
  const site = useMountedSiteAgents(accountUid)
  const orphans = useOrphanAgents(accountUid)
  const serverUrls = useMemo(() => Array.from(new Set(site.agents.map((entry) => entry.serverUrl))), [site.agents])
  const usable = site.agents.length > 0
  const orphanCount = orphans.settled ? orphans.agents.length : 0
  useEffect(() => {
    onAgentsChange({usable, orphans: orphanCount})
  }, [usable, orphanCount, onAgentsChange])
  // First run on this device: what already happened counts as read.
  useSiteAgentReadBaseline(accountUid)
  return <AgentActivityLiveUpdates serverUrls={serverUrls} accountUid={accountUid} />
}
