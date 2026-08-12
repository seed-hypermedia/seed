import {useCreateAccount, useLocalKeyPair, useLocalKeyPairLoaded} from '@/auth'
import {registerWebAgentsPlatform} from '@/web-agents-platform'
import {useNavRoute} from '@shm/shared/utils/navigation'
import AgentDetailRoutePage from '@shm/ui/agents/detail'
import AgentsListPage from '@shm/ui/agents/list'
import AgentServerPage from '@shm/ui/agents/server'
import AgentSessionRoutePage from '@shm/ui/agents/session'
import {Button} from '@shm/ui/button'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'

// Register the web platform adapter before any agents UI renders. This module is only loaded from
// the client-lazy agents chunk, so the registration never runs during SSR rendering of other pages.
registerWebAgentsPlatform()

function SignedOutNotice() {
  const {content, createAccount} = useCreateAccount({})
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 py-24">
      <SizableText size="lg" weight="bold">
        Agents
      </SizableText>
      <SizableText className="text-muted-foreground max-w-md text-center">
        Sign in to configure and chat with your agents. Your local web identity signs every agent action, so agents are
        only available once you are signed in.
      </SizableText>
      <Button onClick={() => createAccount({source: 'login'})}>Sign in</Button>
      {content}
    </div>
  )
}

function AgentsRouteSwitch() {
  const route = useNavRoute()
  switch (route.key) {
    case 'agent-server':
      return <AgentServerPage />
    case 'agent':
      return <AgentDetailRoutePage />
    case 'agent-session':
      return <AgentSessionRoutePage />
    default:
      return <AgentsListPage />
  }
}

/** Client-only body of the /hm/agents pages: login gate plus the shared agents routes. */
export default function WebAgentsContent() {
  const keyPairLoaded = useLocalKeyPairLoaded()
  const keyPair = useLocalKeyPair()

  if (!keyPairLoaded) {
    return (
      <div className="flex flex-1 items-center justify-center py-24">
        <Spinner />
      </div>
    )
  }
  if (!keyPair) {
    return <SignedOutNotice />
  }
  return <AgentsRouteSwitch />
}
