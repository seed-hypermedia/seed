import type React from "react"
import { useNavigate } from "react-router-dom"
import { ErrorMessage } from "@/frontend/components/ErrorMessage"
import { Button } from "@/frontend/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/frontend/components/ui/card"
import { Input } from "@/frontend/components/ui/input"
import { Label } from "@/frontend/components/ui/label"
import { useActions, useAppState } from "@/frontend/store"

/**
 * View for initiating an email address change.
 * User enters their new email address and clicks submit.
 */
export function ChangeEmailView() {
	const { newEmail, loading, error, session } = useAppState()
	const actions = useActions()
	const navigate = useNavigate()

	const handleSubmit = (e: React.FormEvent) => {
		e.preventDefault()
		actions.handleStartEmailChange()
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-center">Change Email Address</CardTitle>
				<CardDescription className="text-center">
					Current email: <strong>{session?.email}</strong>
				</CardDescription>
			</CardHeader>
			<CardContent>
				<ErrorMessage message={error} />

				<form onSubmit={handleSubmit} className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="new-email">New Email Address</Label>
						<Input
							id="new-email"
							type="email"
							placeholder="Enter your new email"
							value={newEmail}
							onChange={(e) => actions.setNewEmail(e.target.value)}
							disabled={loading}
							required
						/>
					</div>

					<Button type="submit" disabled={loading || !newEmail} className="w-full">
						{loading ? "Sending..." : "Send Verification Link"}
					</Button>
				</form>

				<Button variant="secondary" className="mt-4 w-full" onClick={() => navigate("/vault")} disabled={loading}>
					Cancel
				</Button>
			</CardContent>
		</Card>
	)
}
