import { Link } from "react-router-dom"
import { Button } from "@/frontend/components/ui/button"
import { useActions, useAppState } from "@/frontend/store"

/**
 * Application header with user info and logout button.
 */
export function Header() {
	const { session } = useAppState()
	const actions = useActions()

	return (
		<header className="flex items-center justify-between px-8 py-4 bg-panel border-b border-border">
			<Link
				to="/"
				className="text-xl font-semibold !text-primary hover:!text-primary hover:no-underline hover:opacity-80 transition-opacity"
			>
				🔐 Seed Hypermedia Identity Vault
			</Link>
			{session?.authenticated && (
				<div className="flex items-center gap-4">
					<span className="text-sm text-muted-foreground">{session.email}</span>
					<Button variant="secondary" size="sm" onClick={actions.handleLogout}>
						Sign out
					</Button>
				</div>
			)}
		</header>
	)
}
