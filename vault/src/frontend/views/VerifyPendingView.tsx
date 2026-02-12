import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { Spinner } from "@/frontend/components/Spinner"
import { Alert, AlertDescription } from "@/frontend/components/ui/alert"
import { Button } from "@/frontend/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/frontend/components/ui/card"
import { useAppState } from "@/frontend/store"

function Countdown({ seconds }: { seconds: number }) {
	const [timeLeft, setTimeLeft] = useState(seconds)

	useEffect(() => {
		if (timeLeft <= 0) return

		const intervalId = setInterval(() => {
			setTimeLeft((t) => t - 1)
		}, 1000)

		return () => clearInterval(intervalId)
	}, [timeLeft])

	const minutes = Math.floor(timeLeft / 60)
	const remainingSeconds = timeLeft % 60
	const formattedTime = `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`

	return <p className="mt-2 text-sm opacity-80">Link expires in {formattedTime}</p>
}

/**
 * View shown while waiting for the user to click the magic link.
 * Displays instructions and a spinner while polling for verification.
 */
export function VerifyPendingView() {
	const { email, error } = useAppState()
	const navigate = useNavigate()

	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-center">Email Sent</CardTitle>
				<CardDescription className="text-center">
					We sent a verification link to <strong>{email}</strong>
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Alert variant="info" className="my-6">
					<AlertDescription>
						<p>Click the link in your email to continue.</p>
						<Countdown seconds={120} />
					</AlertDescription>
				</Alert>

				<div className="flex justify-center my-8">
					<Spinner size="lg" />
				</div>

				<p className="text-center text-sm opacity-70">Waiting for verification...</p>

				{error && (
					<Alert variant="destructive" className="mt-6">
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				)}

				<Button variant="ghost" className="mt-4 w-full" onClick={() => navigate("/")}>
					← Back
				</Button>
			</CardContent>
		</Card>
	)
}
