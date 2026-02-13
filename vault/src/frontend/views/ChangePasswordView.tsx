import type React from "react"
import { useNavigate } from "react-router-dom"
import { ErrorMessage } from "@/frontend/components/ErrorMessage"
import { PasswordInput } from "@/frontend/components/PasswordInput"
import { Button } from "@/frontend/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/frontend/components/ui/card"
import { useActions, useAppState } from "@/frontend/store"

/**
 * View for changing the master password.
 */
export function ChangePasswordView() {
	const { email, password, confirmPassword, loading, error } = useAppState()
	const actions = useActions()
	const navigate = useNavigate()

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault()
		actions.handleChangePassword()
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-center">Change Password</CardTitle>
				{/* 
					Using non-breaking space (Unicode 00A0) here is a quick way 
					to ensure we have some vertical space.
				*/}
				<CardDescription className="text-center">Set a new master password</CardDescription>
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
						label="New Password"
						value={password}
						onChange={actions.setPassword}
						autoComplete="new-password"
						autoFocus
						showStrength
					/>

					<PasswordInput
						id="confirm-password"
						label="Confirm New Password"
						value={confirmPassword}
						onChange={actions.setConfirmPassword}
						autoComplete="new-password"
					/>

					<Button type="submit" loading={loading} className="w-full">
						Change Password
					</Button>
				</form>

				<Button variant="ghost" className="mt-4 w-full" onClick={() => navigate("/vault")}>
					← Back to Vault
				</Button>
			</CardContent>
		</Card>
	)
}
