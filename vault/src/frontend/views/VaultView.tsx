import { useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { Divider } from "@/frontend/components/Divider"
import { ErrorMessage } from "@/frontend/components/ErrorMessage"
import { Alert, AlertDescription } from "@/frontend/components/ui/alert"
import { Button } from "@/frontend/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/frontend/components/ui/card"
import { Label } from "@/frontend/components/ui/label"
import { Textarea } from "@/frontend/components/ui/textarea"
import * as crypto from "@/frontend/crypto"
import { useActions, useAppState } from "@/frontend/store"

/**
 * Main vault view showing decrypted content.
 */
export function VaultView() {
	const { session, decryptedDEK, loading, error, passkeySupported, vaultContent } = useAppState()
	const actions = useActions()
	const navigate = useNavigate()

	useEffect(() => {
		if (decryptedDEK) {
			actions.loadVaultContent()
		}
	}, [decryptedDEK, actions])

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-center">🔓 Vault Unlocked</CardTitle>
				<CardDescription className="text-center">Your vault has been decrypted client-side</CardDescription>
			</CardHeader>
			<CardContent>
				{decryptedDEK && (
					<Alert variant="success" className="mb-4">
						<AlertDescription>✓ Data Encryption Key is in memory. Server never saw your password!</AlertDescription>
					</Alert>
				)}

				<div className="mb-6 space-y-2">
					<Label htmlFor="vault-key">Data Encryption Key (first 16 bytes)</Label>
					<div id="vault-key" className="bg-muted rounded-lg p-4 font-mono text-xs break-all max-h-50 overflow-y-auto">
						{decryptedDEK ? `${crypto.base64urlEncode(decryptedDEK.slice(0, 16))}...` : "Not available"}
					</div>
				</div>

				<Divider>Vault Content</Divider>

				<div className="mb-6 space-y-2">
					<Label htmlFor="vault-content">Your encrypted notes</Label>
					<Textarea
						id="vault-content"
						className="min-h-[150px] resize-y"
						value={vaultContent}
						onChange={(e) => actions.setVaultContent(e.target.value)}
						placeholder="Enter your secret notes here..."
						disabled={loading}
					/>
				</div>

				<Button className="mb-4 w-full" onClick={actions.saveVaultContent} loading={loading}>
					💾 Save Vault
				</Button>

				<Divider>Account Recovery</Divider>

				<Alert variant="info" className="mb-4">
					<AlertDescription>
						Using additional credentials helps you recover your account in case you lose your primary one.
					</AlertDescription>
				</Alert>

				{passkeySupported && (
					<Button variant="secondary" className="mb-2 w-full" onClick={actions.handleRegisterPasskey} loading={loading}>
						🔑 Add Passkey
					</Button>
				)}

				{!session?.hasPassword && (
					<Button variant="secondary" onClick={() => navigate("/password/add")} disabled={loading} className="w-full">
						🔒 Add Master Password
					</Button>
				)}

				<Divider>Account Settings</Divider>

				<Button
					variant="secondary"
					className="mb-2 w-full"
					onClick={() => navigate("/email/change")}
					disabled={loading}
				>
					📧 Change Email Address
				</Button>

				{session?.hasPassword && (
					<Button
						variant="secondary"
						className="mb-2 w-full"
						onClick={() => navigate("/password/change")}
						disabled={loading}
					>
						🔒 Change Master Password
					</Button>
				)}

				<ErrorMessage message={error} className="mt-4" />
			</CardContent>
		</Card>
	)
}
