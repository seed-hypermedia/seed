import { useEffect } from "react"
import { createBrowserRouter, Outlet } from "react-router-dom"
import { Header } from "./components/Header"
import { useActions, useAppState } from "./store"
import { AddPasswordView } from "./views/AddPasswordView"
import { ChangeEmailPendingView } from "./views/ChangeEmailPendingView"
import { ChangeEmailVerifyView } from "./views/ChangeEmailVerifyView"
import { ChangeEmailView } from "./views/ChangeEmailView"
import { ChangePasswordView } from "./views/ChangePasswordView"
import { ChooseAuthView } from "./views/ChooseAuthView"
import { LockedView } from "./views/LockedView"
import { LoginView } from "./views/LoginView"
import { PreLoginView } from "./views/PreLoginView"
import { SetPasswordView } from "./views/SetPasswordView"
import { VaultView } from "./views/VaultView"
import { VerifyLinkView } from "./views/VerifyLinkView"
import { VerifyPendingView } from "./views/VerifyPendingView"

const RootLayout = () => {
	const actions = useActions()

	useEffect(() => {
		actions.checkSession()
		actions.checkPasskeySupport()
	}, [actions])

	return (
		<>
			<Header />
			<main className="flex-1 flex items-center justify-center p-8">
				<div className="w-full max-w-md">
					<Outlet />
				</div>
			</main>
		</>
	)
}

/** Renders VaultView or PreLoginView depending on auth state. */
const RootView = () => {
	const { session, decryptedDEK } = useAppState()
	if (session?.authenticated && decryptedDEK) {
		return <VaultView />
	}
	return <PreLoginView />
}

/** Creates the application router with all route definitions. */
export function createRouter() {
	return createBrowserRouter(
		[
			{
				element: <RootLayout />,
				children: [
					{
						path: "/",
						element: <RootView />,
					},
					{
						path: "/login",
						element: <LoginView />,
					},
					{
						path: "/verify/pending",
						element: <VerifyPendingView />,
					},
					{
						path: "/verify/:challengeId/:token",
						element: <VerifyLinkView />,
					},
					{
						path: "/auth/choose",
						element: <ChooseAuthView />,
					},
					{
						path: "/password/set",
						element: <SetPasswordView />,
					},
					{
						path: "/password/add",
						element: <AddPasswordView />,
					},
					{
						path: "/password/change",
						element: <ChangePasswordView />,
					},
					{
						path: "/locked",
						element: <LockedView />,
					},
					{
						path: "/email/change",
						element: <ChangeEmailView />,
					},
					{
						path: "/email/change-pending",
						element: <ChangeEmailPendingView />,
					},
					{
						path: "/email/change-verify/:challengeId/:token",
						element: <ChangeEmailVerifyView />,
					},
				],
			},
		],
		{ basename: "/vault" },
	)
}
