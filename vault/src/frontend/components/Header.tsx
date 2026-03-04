import {Link} from 'react-router-dom'
import {Button} from '@/frontend/components/ui/button'
import {useActions, useAppState} from '@/frontend/store'

/**
 * Application header with user info and logout button.
 */
export function Header() {
  const {session} = useAppState()
  const actions = useActions()

  return (
    <header className="bg-panel border-border flex items-center justify-between border-b px-8 py-4">
      <Link
        to="/"
        className="!text-primary hover:!text-primary text-xl font-semibold transition-opacity hover:no-underline hover:opacity-80"
      >
        🔐 Seed Hypermedia Identity Vault
      </Link>
      {session?.authenticated && (
        <div className="flex items-center gap-4">
          <span className="text-muted-foreground text-sm">{session.email}</span>
          <Button variant="secondary" size="sm" onClick={actions.handleLogout}>
            Sign out
          </Button>
        </div>
      )}
    </header>
  )
}
