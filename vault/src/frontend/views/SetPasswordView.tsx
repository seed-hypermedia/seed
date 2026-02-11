import type React from "react"
import { ErrorMessage } from "@/frontend/components/ErrorMessage"
import { PasswordInput } from "@/frontend/components/PasswordInput"
import { Button } from "@/frontend/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/frontend/components/ui/card"
import { useActions, useAppState } from "@/frontend/store"

/**
 * View for setting master password during registration.
 */
export function SetPasswordView() {
	const { email, password, confirmPassword, loading, error } = useAppState()
	const actions = useActions()

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault()
		actions.handleSetPassword()
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-center">Set Master Password</CardTitle>
				<CardDescription className="text-center">Create a strong password to protect your vault</CardDescription>
			</CardHeader>
			<CardContent>
				<ErrorMessage message={error} />

				<form onSubmit={handleSubmit} className="space-y-4">
					{/* Hidden username field for password manager autofill. */}
					<input
						type="text"
						name="username"
						value={email}
						autoComplete="username"
						className="absolute opacity-0 pointer-events-none h-0 w-0 m-0"
						readOnly
						tabIndex={-1}
					/>

					<PasswordInput
						id="password"
						label="Master Password"
						value={password}
						onChange={actions.setPassword}
						autoComplete="new-password"
						autoFocus
						showStrength
					/>

					<PasswordInput
						id="confirm-password"
						label="Confirm Password"
						value={confirmPassword}
						onChange={actions.setConfirmPassword}
						autoComplete="new-password"
					/>

					<Button type="submit" loading={loading} className="w-full">
						Create Account
					</Button>
				</form>
			</CardContent>
		</Card>
	)
}
