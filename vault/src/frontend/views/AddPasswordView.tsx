import type React from "react"
import { useNavigate } from "react-router-dom"
import { ErrorMessage } from "@/frontend/components/ErrorMessage"
import { PasswordInput } from "@/frontend/components/PasswordInput"
import { Button } from "@/frontend/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/frontend/components/ui/card"
import { useActions, useAppState } from "@/frontend/store"

/**
 * View for adding a master password as a backup method.
 */
export function AddPasswordView() {
	const { email, password, confirmPassword, loading, error } = useAppState()
	const actions = useActions()
	const navigate = useNavigate()

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault()
		actions.handleAddPassword()
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-center">Add Master Password</CardTitle>
				<CardDescription className="text-center">Create a password as a backup method</CardDescription>
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
						Add Password
					</Button>
				</form>

				<Button variant="ghost" className="mt-4 w-full" onClick={() => navigate("/")}>
					← Back to Vault
				</Button>
			</CardContent>
		</Card>
	)
}
