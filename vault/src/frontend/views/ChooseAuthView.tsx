import { useNavigate } from "react-router-dom"
import { Divider } from "@/frontend/components/Divider"
import { ErrorMessage } from "@/frontend/components/ErrorMessage"
import { Alert, AlertDescription, AlertTitle } from "@/frontend/components/ui/alert"
import { Button } from "@/frontend/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/frontend/components/ui/card"
import { useActions, useAppState } from "@/frontend/store"

/**
 * View for choosing authentication method during registration.
 */
export function ChooseAuthView() {
	const { loading, error, passkeySupported, platformAuthAvailable } = useAppState()
	const actions = useActions()
	const navigate = useNavigate()

	const showPasskeyOption = passkeySupported

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-center">Secure Your Account</CardTitle>
				<CardDescription className="text-center">
					Choose how you want to protect your vault. Use a password manager if you can!
				</CardDescription>
			</CardHeader>
			<CardContent>
				<ErrorMessage message={error} />

				{showPasskeyOption && (
					<>
						<Button onClick={actions.handleSetPasskey} loading={loading} className="w-full">
							🔑 Use Passkey (Recommended)
						</Button>
						{platformAuthAvailable ? (
							<Alert variant="success" className="my-4">
								<AlertTitle>✓ This device supports passkeys</AlertTitle>
								<AlertDescription>
									Your passkey will be synced across your devices using your operating system integration.
								</AlertDescription>
							</Alert>
						) : (
							<Alert variant="warning" className="my-4">
								<AlertTitle>⚠ This device does not have a built-in passkey authenticator</AlertTitle>
								<AlertDescription>
									You can use a hardware security key (like YubiKey) or a phone/tablet by scanning a QR code.
								</AlertDescription>
							</Alert>
						)}
						<Divider>or</Divider>
					</>
				)}

				<Button variant="secondary" onClick={() => navigate("/password/set")} disabled={loading} className="w-full">
					🔒 Use Master Password
				</Button>
			</CardContent>
		</Card>
	)
}
