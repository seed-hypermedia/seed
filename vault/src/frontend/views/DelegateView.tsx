import * as blobs from "@shm/shared/blobs"
import * as hmauth from "@shm/shared/hmauth"
import { ExternalLink, Plus, Shield, User } from "lucide-react"
import { Navigate, useSearchParams } from "react-router-dom"
import { CreateAccountDialog } from "@/frontend/components/CreateAccountDialog"
import { ErrorMessage } from "@/frontend/components/ErrorMessage"
import { Button } from "@/frontend/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/frontend/components/ui/card"
import { useActions, useAppState } from "@/frontend/store"

/**
 * Consent screen for delegating authority to a third-party site.
 * Shows the requesting origin, allows account selection, and lets the user
 * authorize or deny the delegation request.
 */
export function DelegateView() {
	const { delegationRequest, vaultData, selectedAccountIndex, loading, error } = useAppState()
	const actions = useActions()
	const [searchParams] = useSearchParams()

	const accounts = vaultData?.accounts ?? []

	if (!delegationRequest && !searchParams.has(hmauth.PARAM_CLIENT_ID)) {
		return <Navigate to="/" replace />
	}

	// URL has params but store hasn't synced yet — wait for the effect.
	if (!delegationRequest) {
		return null
	}

	const hasAccounts = accounts.length > 0

	if (!hasAccounts && vaultData) {
		return (
			<>
				<Card>
					<CardHeader>
						<div className="mb-2 flex items-center justify-center">
							<div className="bg-primary/10 flex size-12 items-center justify-center rounded-full">
								<User className="text-primary size-6" />
							</div>
						</div>
						<CardTitle className="text-center">No Accounts</CardTitle>
						<CardDescription className="text-center">
							You need to create an account before you can authorize access.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<Button className="w-full" onClick={() => actions.setCreatingAccount(true)}>
							<Plus className="size-4" />
							Create Account
						</Button>
					</CardContent>
				</Card>
				<CreateAccountDialog />
			</>
		)
	}

	const sessionKeyTruncated =
		delegationRequest.sessionKeyPrincipal.length > 24
			? `${delegationRequest.sessionKeyPrincipal.slice(0, 16)}\u2026${delegationRequest.sessionKeyPrincipal.slice(-8)}`
			: delegationRequest.sessionKeyPrincipal

	const hasValidSelection = selectedAccountIndex >= 0 && selectedAccountIndex < accounts.length

	return (
		<Card>
			<CardHeader>
				<div className="mb-2 flex items-center justify-center">
					<div className="flex size-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
						<Shield className="size-6 text-amber-600 dark:text-amber-400" />
					</div>
				</div>
				<CardTitle className="text-center">Authorize Access</CardTitle>
				<CardDescription className="text-center">
					<ExternalLink className="inline size-3.5 align-text-bottom" />{" "}
					<span className="text-foreground font-medium">{delegationRequest.clientId}</span> is requesting access to act
					on behalf of your account.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6">
				<ErrorMessage message={error} />

				{/* Account selection */}
				{accounts.length > 1 && (
					<div className="space-y-2">
						<p className="text-sm font-medium">Select an account</p>
						<div className="space-y-1">
							{accounts.map((account, index) => {
								const principal = blobs.principalToString(account.profile.decoded.signer)
								const isSelected = index === selectedAccountIndex
								return (
									<button
										type="button"
										key={principal}
										className={`flex w-full cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 text-left transition-colors ${
											isSelected
												? "border-primary bg-primary/5 ring-primary/20 ring-1"
												: "hover:bg-muted/50 border-transparent"
										}`}
										onClick={() => actions.selectAccount(index)}
									>
										<div className="bg-primary/10 flex size-8 shrink-0 items-center justify-center rounded-full">
											<User className="text-primary size-4" />
										</div>
										<div className="min-w-0">
											<div className="truncate text-sm font-medium">{account.profile.decoded.name || "Unnamed"}</div>
											<div className="text-muted-foreground truncate font-mono text-xs">{principal}</div>
										</div>
									</button>
								)
							})}
						</div>
					</div>
				)}

				{/* Delegation details */}
				<div className="bg-muted/50 space-y-2 rounded-md p-3 text-sm">
					<div className="flex justify-between">
						<span className="text-muted-foreground">Session key</span>
						<code className="font-mono text-xs">{sessionKeyTruncated}</code>
					</div>
					<div className="flex justify-between">
						<span className="text-muted-foreground">Role</span>
						<span className="font-medium">Agent</span>
					</div>
				</div>

				{/* Actions */}
				<div className="flex flex-col gap-2">
					<Button
						className="w-full"
						loading={loading}
						disabled={!hasValidSelection}
						onClick={actions.completeDelegation}
					>
						Authorize
					</Button>
					<Button variant="ghost" className="w-full" disabled={loading} onClick={actions.cancelDelegation}>
						Deny
					</Button>
				</div>
			</CardContent>
		</Card>
	)
}
