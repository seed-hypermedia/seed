import type React from "react"
import { ErrorMessage } from "@/frontend/components/ErrorMessage"
import { Button } from "@/frontend/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/frontend/components/ui/card"
import { Input } from "@/frontend/components/ui/input"
import { Label } from "@/frontend/components/ui/label"
import { useActions, useAppState } from "@/frontend/store"

/**
 * Initial view for email entry before sign in/registration.
 */
export function PreLoginView() {
	const { email, loading, sendingEmail, error } = useAppState()
	const actions = useActions()

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
							placeholder="you@example.com"
							value={email}
							onChange={(e) => actions.setEmail(e.target.value)}
							required
							autoComplete="username webauthn"
						/>
					</div>

					<Button type="submit" loading={loading} className="w-full">
						{sendingEmail ? "Sending verification email..." : "Continue"}
					</Button>
				</form>
			</CardContent>
		</Card>
	)
}
