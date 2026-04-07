import {useEffect} from 'react'
import {createBrowserRouter, Navigate, Outlet, useNavigate} from 'react-router-dom'
import {Divider} from './components/Divider'
import {ErrorMessage} from './components/ErrorMessage'
import {Header} from './components/Header'
import {Button} from './components/ui/button'
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from './components/ui/card'
import {useActions, useAppState} from './store'
import {AddPasswordView} from './views/AddPasswordView'
import {ChangeEmailPendingView} from './views/ChangeEmailPendingView'
import {ChangeEmailVerifyView} from './views/ChangeEmailVerifyView'
import {ChangeEmailView} from './views/ChangeEmailView'
import {ChangeNotifyServerUrlView} from './views/ChangeNotifyServerUrlView'
import {ChangePasswordView} from './views/ChangePasswordView'
import {ChooseAuthView} from './views/ChooseAuthView'
import {CreateProfileView} from './views/CreateProfileView'
import {DelegateView} from './views/DelegateView'
import {LoginView} from './views/LoginView'
import {PreLoginView} from './views/PreLoginView'
import {SetPasswordView} from './views/SetPasswordView'
import {SettingsView} from './views/SettingsView'
import {VaultView} from './views/VaultView'
import {VerifyLinkView} from './views/VerifyLinkView'
import {VerifyPendingView} from './views/VerifyPendingView'

/**
 * Redirects to `/` if the user is authenticated and vault keys are available.
 * Wrap auth routes that should not be visible when fully unlocked.
 */
function RedirectIfUnlocked() {
  const {session, decryptedDEK, delegationRequest} = useAppState()

  if (session?.authenticated && decryptedDEK) {
    if (delegationRequest) {
      return <Navigate to="/delegate" replace />
    }
    return <Navigate to="/" replace />
  }

  return <Outlet />
}

/**
 * Ensures the user is authenticated and the vault is unlocked.
 * If authenticated but locked, renders the inline lock screen.
 * If not authenticated, redirects to home.
 */
function LockedView() {
  const {session, loading, error, passkeySupported} = useAppState()
  const actions = useActions()
  const navigate = useNavigate()

  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle className="text-left text-xl">Add your passkey to continue</CardTitle>
        <CardDescription className="text-left">Sign in using your device.</CardDescription>
      </CardHeader>
      <CardContent>
        <ErrorMessage message={error} />

        {passkeySupported && session?.credentials?.passkey && (
          <Button onClick={actions.handleQuickUnlock} loading={loading} className="w-full">
            Use passkey
          </Button>
        )}

        {session?.credentials?.password && (
          <>
            <Divider>or</Divider>
            <Button variant="secondary" onClick={() => navigate('/login')} disabled={loading} className="w-full">
              Use Master Password
            </Button>
          </>
        )}

        <Button variant="ghost" className="mt-4 w-full" onClick={actions.handleLogout}>
          Sign out
        </Button>
      </CardContent>
    </Card>
  )
}

/**
 * Ensures the user is authenticated and the vault is unlocked.
 * If authenticated but locked, renders the inline lock screen.
 * If not authenticated, redirects to home.
 */
function EnsureUnlocked() {
  const {session, decryptedDEK, sessionChecked} = useAppState()

  if (!sessionChecked) {
    return null // Or a loading spinner
  }

  if (!session?.authenticated) {
    return <Navigate to="/" replace />
  }

  if (!decryptedDEK) {
    return <LockedView />
  }

  return <Outlet />
}

/** Narrow container for auth flows. */
function NarrowLayout() {
  return (
    <div className="w-full max-w-lg">
      <Outlet />
    </div>
  )
}

/** Wide container for vault and settings views. */
function WideLayout() {
  return (
    <div className="w-full max-w-5xl">
      <Outlet />
    </div>
  )
}

/** Application shell shared across all vault routes. */
export function RootLayout() {
  const actions = useActions()

  useEffect(() => {
    actions.checkSession()
    actions.parseDelegationFromUrl(window.location.href)
  }, [actions])

  return (
    <>
      <Header />
      <main className="flex flex-1 items-center justify-center p-4 md:p-8">
        <Outlet />
      </main>
    </>
  )
}

function RootView() {
  const {session, decryptedDEK, delegationRequest, sessionChecked} = useAppState()

  if (!sessionChecked) {
    return null
  }

  if (session?.authenticated) {
    if (!decryptedDEK) {
      return (
        <div className="w-full max-w-lg">
          <LockedView />
        </div>
      )
    }

    if (delegationRequest) {
      return <Navigate to="/delegate" replace />
    }
    return (
      <div className="w-full max-w-5xl">
        <VaultView />
      </div>
    )
  }

  return (
    <div className="w-full max-w-lg">
      <PreLoginView />
    </div>
  )
}

/** Creates the application router with all route definitions. */
export function createRouter() {
  return createBrowserRouter(
    [
      {
        element: <RootLayout />,
        children: [
          {
            path: '/',
            element: <RootView />,
          },
          {
            element: <NarrowLayout />,
            children: [
              {
                element: <RedirectIfUnlocked />,
                children: [
                  {
                    path: '/login',
                    element: <LoginView />,
                  },
                  {
                    path: '/auth/choose',
                    element: <ChooseAuthView />,
                  },
                  {
                    path: '/password/set',
                    element: <SetPasswordView />,
                  },
                ],
              },
              {
                path: '/verify/pending',
                element: <VerifyPendingView />,
              },
              {
                path: '/verify/:challengeId/:token',
                element: <VerifyLinkView />,
              },
              {
                element: <EnsureUnlocked />,
                children: [
                  {
                    path: '/password/add',
                    element: <AddPasswordView />,
                  },
                  {
                    path: '/password/change',
                    element: <ChangePasswordView />,
                  },
                  {
                    path: '/profile/create',
                    element: <CreateProfileView />,
                  },
                  {
                    path: '/email/change',
                    element: <ChangeEmailView />,
                  },
                  {
                    path: '/notify-server/change',
                    element: <ChangeNotifyServerUrlView />,
                  },
                  {
                    path: '/email/change-pending',
                    element: <ChangeEmailPendingView />,
                  },
                  {
                    path: '/delegate',
                    element: <DelegateView />,
                  },
                ],
              },
              {
                path: '/email/change-verify/:challengeId/:token',
                element: <ChangeEmailVerifyView />,
              },
            ],
          },
          {
            element: <WideLayout />,
            children: [
              {
                element: <EnsureUnlocked />,
                children: [
                  {
                    path: '/settings',
                    element: <SettingsView />,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    {basename: '/vault'},
  )
}
