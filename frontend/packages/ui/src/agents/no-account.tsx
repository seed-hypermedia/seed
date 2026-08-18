import {Button} from '@shm/ui/button'
import {Container, PanelContainer} from '@shm/ui/container'
import {SizableText} from '@shm/ui/text'
import {Bot, LogIn} from 'lucide-react'
import {getAgentsPlatform, type AgentsSignInPrompt} from './platform'

// The platform is registered once before render and never swapped, so resolving the optional
// sign-in hook through a wrapper keeps hook order stable across renders.
const useSignInPromptHook: () => AgentsSignInPrompt = () => {
  return (getAgentsPlatform().useSignInPrompt ?? (() => ({hasAccounts: false})))()
}

/**
 * Agent servers only accept authenticated requests, so without an active account the page cannot
 * talk to any of them — including the local one. Instead of rendering server rows whose requests
 * would all fail, explain the blocker and offer the fix.
 */
export function AgentsNoAccountPage() {
  const {hasAccounts, signIn, dialog} = useSignInPromptHook()

  return (
    <PanelContainer className="overflow-y-auto">
      <Container className="max-w-4xl gap-6 py-8">
        <div className="flex items-center gap-3">
          <div className="bg-primary/10 text-primary flex size-11 items-center justify-center rounded-xl">
            <Bot className="size-6" />
          </div>
          <SizableText size="2xl" weight="bold">
            Agents
          </SizableText>
        </div>

        <section className="border-border bg-card flex flex-col items-start gap-3 rounded-lg border p-6">
          <SizableText weight="bold">Sign in to use agents</SizableText>
          <SizableText color="muted">
            {hasAccounts
              ? 'Agent servers require an authenticated account. Select an account from the account menu in the top-right corner to continue.'
              : 'Agent servers require an authenticated account. Sign in or create an account to get started.'}
          </SizableText>
          {!hasAccounts && signIn ? (
            <Button onClick={() => signIn()}>
              <LogIn className="size-4" />
              Sign in
            </Button>
          ) : null}
        </section>

        {dialog}
      </Container>
    </PanelContainer>
  )
}
