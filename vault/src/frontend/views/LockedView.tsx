import { useNavigate } from "react-router-dom"
import { Divider } from "@/frontend/components/Divider"
import { ErrorMessage } from "@/frontend/components/ErrorMessage"
import { Button } from "@/frontend/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/frontend/components/ui/card"
import { useActions, useAppState } from "@/frontend/store"

/**
 * View shown when the vault is locked and requires authentication.
 */
export function LockedView() {
	const { session, loading, error, passkeySupported } = useAppState()
	const actions = useActions()
	const navigate = useNavigate()

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-center">🔒 Vault Locked</CardTitle>
				<CardDescription className="text-center">Authenticate to unlock your vault</CardDescription>
			</CardHeader>
			<CardContent>
				<ErrorMessage message={error} />

				<p className="text-sm text-muted-foreground text-center mb-6">Signed in as {session?.email}</p>

				{passkeySupported && (
					<Button onClick={actions.handleQuickUnlock} loading={loading} className="w-full">
						🔑 Unlock with Passkey
					</Button>
				)}

				{session?.hasPassword && (
					<>
						<Divider>or</Divider>
						<Button variant="secondary" onClick={() => navigate("/login")} disabled={loading} className="w-full">
							🔒 Use Master Password
						</Button>
					</>
				)}

				<Button variant="ghost" className="mt-4 w-full" onClick={actions.handleLogout}>
					Sign out
				</Button>
			</CardContent>
		</Card>
	)
}
