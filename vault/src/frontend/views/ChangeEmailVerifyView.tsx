import { useEffect } from "react"
import { useParams } from "react-router-dom"
import { ErrorMessage } from "@/frontend/components/ErrorMessage"
import { Spinner } from "@/frontend/components/Spinner"
import { Card, CardContent, CardHeader, CardTitle } from "@/frontend/components/ui/card"
import { useActions, useAppState } from "@/frontend/store"

/**
 * View shown when user clicks the email change magic link.
 * Shows confirmation that the email change was verified.
 */
export function ChangeEmailVerifyView() {
	const { newEmail, loading, error } = useAppState()
	const actions = useActions()
	const { challengeId, token } = useParams<{ challengeId: string; token: string }>()

	useEffect(() => {
		if (challengeId && token) {
			actions.handleVerifyEmailChangeLink(challengeId, token)
		}
	}, [actions, challengeId, token])

	const title = loading ? "Verifying..." : error ? "Verification Failed" : "Email Change Verified!"

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-center">{title}</CardTitle>
			</CardHeader>
			<CardContent>
				<ErrorMessage message={error} />

				{!loading && !error && (
					<>
						<div className="text-center my-6">
							<div className="size-15 mx-auto rounded-full bg-brand-6 flex items-center justify-center text-3xl text-white">
								✓
							</div>
						</div>

						<p className="text-center text-muted-foreground mb-8">
							Email change to <strong>{newEmail}</strong> has been confirmed.
						</p>

						<p className="text-center opacity-80 mt-6">You can now close this window.</p>
					</>
				)}

				{loading && (
					<div className="flex justify-center my-8">
						<Spinner size="lg" />
					</div>
				)}
			</CardContent>
		</Card>
	)
}
