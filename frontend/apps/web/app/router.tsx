import {createRootRoute, createRoute, createRouter, Outlet, RouterProvider, useParams} from '@tanstack/react-router'
import {useEffect, useMemo, useState} from 'react'
import {describeDocumentRoute} from './router-utils'
import {Providers, WebSiteProvider} from './providers'
import {WebResourcePage} from './web-resource-page'
import {createDocumentNavRoute, hmId} from '@shm/shared'

const rootRoute = createRootRoute({
  component: RootRoute,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: DocumentRoute,
})

const catchAllRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '$',
  component: DocumentRoute,
})

const routeTree = rootRoute.addChildren([indexRoute, catchAllRoute])

export const router = createRouter({
  routeTree,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

/** Renders the TanStack Router app. */
export function AppRouter() {
  return <RouterProvider router={router} />
}

function RootRoute() {
  return (
    <Providers>
      <div className="bg-muted min-h-screen font-sans text-slate-950 antialiased dark:text-slate-50">
        <Outlet />
      </div>
    </Providers>
  )
}

function DocumentRoute() {
  const params = useParams({strict: false}) as {_splat?: string}
  const routeInfo = useMemo(() => describeDocumentRoute(params._splat ?? '', window.location.href), [params._splat])
  const [config, setConfig] = useState<{registeredAccountUid?: string; hostname?: string} | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/hm/api/config', {credentials: 'include'})
      .then(async (response) => {
        if (!response.ok) throw new Error(await response.text())
        return response.json() as Promise<{registeredAccountUid?: string; hostname?: string}>
      })
      .then((value) => {
        if (!cancelled) setConfig(value)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (routeInfo.inspectIpfsPath) return <RouteDebugShell routeInfo={routeInfo} />
  if (error) return <RouteDebugShell routeInfo={routeInfo} error={error} />
  if (!config) return <RouteDebugShell routeInfo={routeInfo} error="Loading site config…" />
  if (!config.registeredAccountUid) return <RouteDebugShell routeInfo={routeInfo} error="Site is not registered" />

  const docId = hmId(routeInfo.documentUid || config.registeredAccountUid, {
    path: routeInfo.documentPath,
    version: routeInfo.loaderDeps.version,
    latest: routeInfo.loaderDeps.latest,
  })

  return (
    <WebSiteProvider
      originHomeId={hmId(config.registeredAccountUid)}
      siteHost={window.location.hostname}
      initialRoute={createDocumentNavRoute(
        docId,
        routeInfo.viewTerm,
        routeInfo.activityFilter ? `activity/${routeInfo.activityFilter}` : null,
        routeInfo.openComment,
        routeInfo.accountUid,
      )}
    >
      <WebResourcePage docId={docId} ssrContentHTML={null} />
    </WebSiteProvider>
  )
}

function RouteDebugShell({routeInfo, error}: {routeInfo: ReturnType<typeof describeDocumentRoute>; error?: string}) {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-6 py-12">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-950">
        <p className="mb-2 text-sm font-medium text-slate-500">Seed Web</p>
        <h1 className="text-3xl font-semibold tracking-tight">TanStack Router document route</h1>
        {error ? <p className="mt-3 text-amber-700 dark:text-amber-300">{error}</p> : null}
      </div>
      <section className="rounded-2xl border border-slate-200 bg-white p-6 font-mono text-sm shadow-sm dark:border-slate-800 dark:bg-slate-950">
        <h2 className="mb-4 font-sans text-lg font-semibold">Current route interpretation</h2>
        <pre className="overflow-auto whitespace-pre-wrap">{JSON.stringify(routeInfo, null, 2)}</pre>
      </section>
    </main>
  )
}
