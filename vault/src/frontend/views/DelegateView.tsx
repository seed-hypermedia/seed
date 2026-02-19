import * as blobs from "@shm/shared/blobs"
import { ExternalLink, Plus, Shield, User } from "lucide-react"
import { Navigate, useSearchParams } from "react-router-dom"
import { CreateAccountDialog } from "@/frontend/components/CreateAccountDialog"
import { ErrorMessage } from "@/frontend/components/ErrorMessage"
import { Button } from "@/frontend/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/frontend/components/ui/card"
import * as hmauth from "@/frontend/hmauth"
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
						<div className="flex items-center justify-center mb-2">
							<div className="size-12 rounded-full bg-primary/10 flex items-center justify-center">
								<User className="size-6 text-primary" />
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
				<div className="flex items-center justify-center mb-2">
					<div className="size-12 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
						<Shield className="size-6 text-amber-600 dark:text-amber-400" />
					</div>
				</div>
				<CardTitle className="text-center">Authorize Access</CardTitle>
				<CardDescription className="text-center">
					<span className="inline-flex items-center gap-1.5">
						<ExternalLink className="size-3.5" />
						<span className="font-medium text-foreground">{delegationRequest.clientId}</span>
					</span>{" "}
					is requesting access to act on behalf of your account.
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
								const principal = blobs.principalToString(account.profile.signer)
								const isSelected = index === selectedAccountIndex
								return (
									<button
										type="button"
										key={principal}
										className={`w-full text-left px-3 py-2.5 rounded-md flex items-center gap-3 transition-colors cursor-pointer border ${
											isSelected
												? "border-primary bg-primary/5 ring-1 ring-primary/20"
												: "border-transparent hover:bg-muted/50"
										}`}
										onClick={() => actions.selectAccount(index)}
									>
										<div className="size-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
											<User className="size-4 text-primary" />
										</div>
										<div className="min-w-0">
											<div className="text-sm font-medium truncate">{account.profile.name || "Unnamed"}</div>
											<div className="text-xs text-muted-foreground font-mono truncate">
												{principal.slice(0, 16)}\u2026
											</div>
										</div>
									</button>
								)
							})}
						</div>
					</div>
				)}

				{/* Delegation details */}
				<div className="rounded-md bg-muted/50 p-3 space-y-2 text-sm">
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
