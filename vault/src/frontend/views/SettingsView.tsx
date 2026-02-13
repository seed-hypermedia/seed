import { ArrowLeft, Key, Mail, Shield } from "lucide-react"
import { useNavigate } from "react-router-dom"
import { ErrorMessage } from "@/frontend/components/ErrorMessage"
import { Alert, AlertDescription } from "@/frontend/components/ui/alert"
import { Button } from "@/frontend/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/frontend/components/ui/card"
import { Separator } from "@/frontend/components/ui/separator"
import { useActions, useAppState } from "@/frontend/store"

/**
 * Vault-level settings view for managing authentication credentials and account settings.
 * These settings apply to the entire vault, not individual Hypermedia accounts.
 */
export function SettingsView() {
	const { session, loading, error, passkeySupported } = useAppState()
	const actions = useActions()
	const navigate = useNavigate()

	return (
		<div className="space-y-6">
			<div className="flex items-center gap-3">
				<Button variant="ghost" size="icon-xs" onClick={() => navigate("/vault")}>
					<ArrowLeft className="size-4" />
				</Button>
				<div>
					<h1 className="text-2xl font-semibold">Vault Settings</h1>
					<p className="text-sm text-muted-foreground">Manage authentication and security for your vault</p>
				</div>
			</div>

			<ErrorMessage message={error} />

			{/* Authentication Methods */}
			<Card>
				<CardHeader>
					<CardTitle>Authentication</CardTitle>
					<CardDescription>
						Manage how you sign in and unlock your vault. Adding multiple methods helps with account recovery.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					{/* Passkeys */}
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							<div className="size-9 rounded-full bg-primary/10 flex items-center justify-center">
								<Key className="size-4 text-primary" />
							</div>
							<div>
								<p className="text-sm font-medium">Passkeys</p>
								<p className="text-xs text-muted-foreground">
									{session?.hasPasskeys ? "One or more passkeys registered" : "No passkeys registered"}
								</p>
							</div>
						</div>
						{passkeySupported && (
							<Button variant="secondary" size="sm" onClick={actions.handleRegisterPasskey} loading={loading}>
								Add Passkey
							</Button>
						)}
					</div>

					<Separator />

					{/* Password */}
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							<div className="size-9 rounded-full bg-primary/10 flex items-center justify-center">
								<Shield className="size-4 text-primary" />
							</div>
							<div>
								<p className="text-sm font-medium">Master Password</p>
								<p className="text-xs text-muted-foreground">
									{session?.hasPassword ? "Password is set" : "No password set"}
								</p>
							</div>
						</div>
						{session?.hasPassword ? (
							<Button variant="secondary" size="sm" onClick={() => navigate("/password/change")} disabled={loading}>
								Change
							</Button>
						) : (
							<Button variant="secondary" size="sm" onClick={() => navigate("/password/add")} disabled={loading}>
								Add Password
							</Button>
						)}
					</div>

					{!passkeySupported && !session?.hasPassword && (
						<>
							<Separator />
							<Alert variant="info">
								<AlertDescription>Add at least one authentication method to protect your vault.</AlertDescription>
							</Alert>
						</>
					)}
				</CardContent>
			</Card>

			{/* Account Settings */}
			<Card>
				<CardHeader>
					<CardTitle>Account</CardTitle>
					<CardDescription>Manage your vault account settings.</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-3">
							<div className="size-9 rounded-full bg-primary/10 flex items-center justify-center">
								<Mail className="size-4 text-primary" />
							</div>
							<div>
								<p className="text-sm font-medium">Email Address</p>
								<p className="text-xs text-muted-foreground">{session?.email}</p>
							</div>
						</div>
						<Button variant="secondary" size="sm" onClick={() => navigate("/email/change")} disabled={loading}>
							Change
						</Button>
					</div>
				</CardContent>
			</Card>
		</div>
	)
}
