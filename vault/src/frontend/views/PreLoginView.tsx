import { WebAuthnAbortService } from "@simplewebauthn/browser"
import type React from "react"
import { useEffect } from "react"
import { Navigate } from "react-router-dom"
import { ErrorMessage } from "@/frontend/components/ErrorMessage"
import { Button } from "@/frontend/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/frontend/components/ui/card"
import { Input } from "@/frontend/components/ui/input"
import { Label } from "@/frontend/components/ui/label"
import { useActions, useAppState } from "@/frontend/store"

/**
 * Initial view for email entry before sign in/registration.
 * Attempts conditional mediation (passkey autofill) on mount so that users
 * with resident passkeys can sign in without typing their email.
 */
export function PreLoginView() {
	const { email, loading, error, passkeySupported, session, sessionChecked } = useAppState()
	const actions = useActions()

	useEffect(() => {
		if (sessionChecked) {
			actions.handleConditionalLogin()
		}
		return () => WebAuthnAbortService.cancelCeremony()
	}, [actions, sessionChecked])

	if (!sessionChecked) {
		return null
	}

	if (session?.authenticated) {
		return <Navigate to="/vault" replace />
	}

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault()
		await actions.handlePreLogin()
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-center">Sign In</CardTitle>
				<CardDescription className="text-center">Enter your email to continue</CardDescription>
			</CardHeader>
			<CardContent>
				<ErrorMessage message={error} />

				<form onSubmit={handleSubmit} className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="email">Email</Label>
						<Input
							id="email"
							name="email"
							type="email"
							placeholder="Email address"
							value={email}
							onChange={(e) => actions.setEmail(e.target.value)}
							required
							autoFocus
							autoComplete="username webauthn"
						/>
					</div>

					<Button type="submit" loading={loading} className="w-full">
						Continue
					</Button>
				</form>

				{passkeySupported && (
					<p className="mt-4 text-center text-sm text-muted-foreground">
						<button
							type="button"
							className="underline underline-offset-2 hover:text-foreground transition-colors cursor-pointer"
							onClick={actions.handleModalPasskeyLogin}
							disabled={loading}
						>
							Sign in with a passkey
						</button>
					</p>
				)}
			</CardContent>
		</Card>
	)
}
