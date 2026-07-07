import {useEffect, useRef} from 'react'
import {createBrowserRouter, Outlet, useLocation} from 'react-router-dom'
import {Divider} from './components/Divider'
import {ErrorMessage} from './components/ErrorMessage'
import {Header} from './components/Header'
import {Button} from './components/ui/button'
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from './components/ui/card'
import * as navigation from './navigation'
import {getPendingFlowPath, useActions, useAppState, VAULT_BASENAME} from './store'
import {AccountSettingsView} from './views/AccountSettingsView'
import {ChooseAuthView} from './views/ChooseAuthView'
import {ConnectSuccessView} from './views/ConnectSuccessView'
import {ConnectView} from './views/ConnectView'
import {CreateProfileView} from './views/CreateProfileView'
import {DelegateView} from './views/DelegateView'
import {LoginView} from './views/LoginView'
import {PreLoginView} from './views/PreLoginView'
import {SetPasswordView} from './views/SetPasswordView'
import {VerifyPendingView} from './views/VerifyPendingView'

/**
 * Redirects to `/` if the user is authenticated and vault keys are available.
 * Wrap auth routes that should not be visible when fully unlocked.
 */
function RedirectIfUnlocked() {
  const {session, decryptedDEK, delegationRequest, vaultConnectionRequest, returnToPath} = useAppState()
  const actions = useActions()
  const unlocked = !!(session?.authenticated && decryptedDEK)

  // Freeze the redirect target on the first unlocked render. The effect below
  // clears returnToPath while <HashNavigate> may still be mounted (store
  // updates notify asynchronously), and a mutable target would make the
  // Navigate re-fire toward '/' and lose the recorded return path.
  const targetRef = useRef<string | null>(null)
  if (!unlocked) {
    targetRef.current = null
  } else if (targetRef.current === null) {
    targetRef.current = getPendingFlowPath({delegationRequest, vaultConnectionRequest, returnToPath})
  }

  // The redirect consumes the recorded return path — clear it so it cannot
  // cause a stray redirect later in the session.
  useEffect(() => {
    if (unlocked && returnToPath) actions.setReturnToPath('')
  }, [unlocked, returnToPath, actions])

  if (unlocked && targetRef.current !== null) {
    return <navigation.HashNavigate to={targetRef.current} replace />
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
  const navigate = navigation.useHashNavigate()
  const location = useLocation()

  const showPasskey = passkeySupported && !!session?.credentials?.passkey
  const showPassword = !!session?.credentials?.password
  const passwordOnly = showPassword && !showPasskey

  // Both unlock paths may detour through /login; remember where the user was
  // (e.g. /settings opened from the desktop app) so they land back here.
  function rememberReturnPath() {
    if (location.pathname !== '/') {
      actions.setReturnToPath(location.pathname)
    }
  }

  // When the password is the only way to unlock, skip this screen's
  // extra button and go straight to the password form on /login.
  useEffect(() => {
    if (!passwordOnly) return
    rememberReturnPath()
    navigate('/login', {replace: true})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [passwordOnly])

  if (passwordOnly) {
    return null
  }

  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader>
        <CardTitle className="text-left text-xl">
          {showPasskey ? 'Add your passkey to continue' : 'Unlock your vault'}
        </CardTitle>
        <CardDescription className="text-left">
          {showPasskey ? 'Sign in using your device.' : 'Sign in with your password to continue.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ErrorMessage message={error} />

        {showPasskey && (
          <Button
            onClick={() => {
              rememberReturnPath()
              actions.handleQuickUnlock()
            }}
            loading={loading}
            className="w-full"
          >
            Use passkey
          </Button>
        )}

        {showPassword && (
          <>
            {showPasskey && <Divider>or</Divider>}
            <Button
              variant={showPasskey ? 'secondary' : 'default'}
              onClick={() => {
                rememberReturnPath()
                navigate('/login')
              }}
              disabled={loading}
              className="w-full"
            >
              Use Password
            </Button>
          </>
        )}

        <Button variant="ghost" className="mt-4 w-full" onClick={actions.handleLogout}>
          Log out
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
  const {session, decryptedDEK, sessionChecked, returnToPath} = useAppState()
  const actions = useActions()
  const location = useLocation()

  const needsAuth = sessionChecked && !session?.authenticated
  const unlocked = !!(session?.authenticated && decryptedDEK)

  // Remember where the user was headed (e.g. /settings opened from the
  // desktop app) so the sign-in flow can return here instead of the root.
  useEffect(() => {
    if (needsAuth && location.pathname !== '/') {
      actions.setReturnToPath(location.pathname)
    }
  }, [needsAuth, location.pathname, actions])

  // Destination reached while unlocked: drop the recorded return path.
  useEffect(() => {
    if (unlocked && returnToPath) actions.setReturnToPath('')
  }, [unlocked, returnToPath, actions])

  if (!sessionChecked) {
    return null // Or a loading spinner
  }

  if (!session?.authenticated) {
    return <navigation.HashNavigate to="/" replace />
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

function hasVaultConnectionFragment() {
  const fragment = window.location.hash.startsWith('#') ? window.location.hash.slice(1) : window.location.hash
  if (!fragment) {
    return false
  }

  const params = new URLSearchParams(fragment)
  return params.has('token') || params.has('callback')
}

/** How often the unlocked vault polls the server for changes made elsewhere. */
const VAULT_REFRESH_POLL_MS = 15_000

/** Application shell shared across all vault routes. */
export function RootLayout() {
  const actions = useActions()
  const isUnlocked = !!useAppState().decryptedDEK

  useEffect(() => {
    void actions.checkSession().catch((error) => {
      console.error('Session check failed:', error)
    })
    actions.parseDelegationFromUrl(window.location.href)
    actions.parseVaultConnectionFromUrl(window.location.href)
  }, [actions])

  // While unlocked, poll for vault data changed on other devices (e.g. desktop).
  useEffect(() => {
    if (!isUnlocked) return
    const intervalId = window.setInterval(() => {
      void actions.refreshVaultData()
    }, VAULT_REFRESH_POLL_MS)
    return () => window.clearInterval(intervalId)
  }, [isUnlocked, actions])

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
  const {session, decryptedDEK, delegationRequest, sessionChecked, vaultConnectionRequest, returnToPath} = useAppState()

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

    const pendingFlowPath = getPendingFlowPath({delegationRequest, vaultConnectionRequest, returnToPath})
    if (pendingFlowPath !== '/') {
      return <navigation.HashNavigate to={pendingFlowPath} replace />
    }

    return (
      <div className="w-full max-w-5xl">
        <AccountSettingsView />
      </div>
    )
  }

  return (
    <div className="w-full max-w-lg">
      <PreLoginView />
    </div>
  )
}

function ConnectRouteView() {
  const {session, decryptedDEK, sessionChecked, vaultConnectionRequest} = useAppState()
  // Completing the flow clears the request while this route is still mounted
  // and the navigation to /connect/success is in flight; redirecting to "/"
  // then would win the race. Only redirect when this route never had a request.
  const hadRequestRef = useRef(false)
  if (vaultConnectionRequest) {
    hadRequestRef.current = true
  }

  if (!sessionChecked) {
    return null
  }

  if (!vaultConnectionRequest && !hasVaultConnectionFragment()) {
    return hadRequestRef.current ? null : <navigation.HashNavigate to="/" replace />
  }

  if (!session?.authenticated) {
    return <PreLoginView />
  }

  if (!decryptedDEK) {
    return <LockedView />
  }

  if (!vaultConnectionRequest) {
    return hadRequestRef.current ? null : <navigation.HashNavigate to="/" replace />
  }

  return <ConnectView />
}

/** Creates the application router with all route definitions. */
export function createRouter() {
  // TODO(burdiyan): some of these routes need more robust guards for checking whether session exists.
  // The current state is harmless — simply may cause confusion if the user navigates to those routes without having a session, and sees a half-baked page.

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
                path: '/connect',
                element: <ConnectRouteView />,
              },
              {
                path: '/connect/success',
                element: <ConnectSuccessView />,
              },
              {
                element: <EnsureUnlocked />,
                children: [
                  {
                    path: '/profile/create',
                    element: <CreateProfileView />,
                  },
                  {
                    path: '/delegate',
                    element: <DelegateView />,
                  },
                ],
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
                    element: <AccountSettingsView />,
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
    {basename: VAULT_BASENAME},
  )
}
