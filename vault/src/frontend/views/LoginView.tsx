import type React from "react"
import { useNavigate } from "react-router-dom"
import { Divider } from "@/frontend/components/Divider"
import { ErrorMessage } from "@/frontend/components/ErrorMessage"
import { PasswordInput } from "@/frontend/components/PasswordInput"
import { Button } from "@/frontend/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/frontend/components/ui/card"
import { useActions, useAppState } from "@/frontend/store"

/**
 * Sign in view for existing users.
 */
export function LoginView() {
	const { email, password, loading, error, passkeySupported, userHasPassword } = useAppState()
	const actions = useActions()
	const navigate = useNavigate()

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault()
		actions.handleLogin()
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-center">Welcome Back</CardTitle>
				<CardDescription className="text-center">Sign in to {email}</CardDescription>
			</CardHeader>
			<CardContent>
				<ErrorMessage message={error} />

				{passkeySupported && (
					<>
						<Button variant="secondary" onClick={actions.handlePasskeyLogin} loading={loading} className="w-full">
							🔑 Sign in with Passkey
						</Button>
						{userHasPassword && <Divider>or</Divider>}
					</>
				)}

				{userHasPassword && (
					<form onSubmit={handleSubmit} className="space-y-4">
						<input type="text" name="username" value={email} autoComplete="username" className="hidden" readOnly />
						<PasswordInput
							id="password"
							label="Master Password"
							value={password}
							onChange={actions.setPassword}
							autoComplete="current-password"
							autoFocus={!passkeySupported}
						/>

						<Button type="submit" loading={loading} className="w-full">
							Sign in
						</Button>
					</form>
				)}

				<Button
					variant="ghost"
					className="mt-4 w-full"
					onClick={() => {
						actions.setEmail("")
						navigate("/")
					}}
				>
					← Use different email
				</Button>
			</CardContent>
		</Card>
	)
}
