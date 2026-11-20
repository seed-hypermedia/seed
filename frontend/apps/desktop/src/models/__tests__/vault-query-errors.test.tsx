import {Code, ConnectError} from '@connectrpc/connect'
import {queryClient} from '@shm/shared/models/query-client'
import {QueryClientProvider} from '@tanstack/react-query'
import React from 'react'
import {ErrorBoundary} from 'react-error-boundary'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'
import {useVaultEmail, useVaultPasswordStatus} from '../daemon'

const {getVaultEmail, getVaultPasswordStatus} = vi.hoisted(() => ({
  getVaultEmail: vi.fn(),
  getVaultPasswordStatus: vi.fn(),
}))

vi.mock('@/grpc-client', () => ({grpcClient: {daemon: {getVaultEmail, getVaultPasswordStatus}}}))
vi.mock('@/trpc', () => ({client: {}}))

Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true})

// The daemon returns this when the device is offline and the remote vault is
// connected: the gRPC call proxies a failed upstream HTTPS request.
const offlineError = new ConnectError(
  'Get "https://hyper.media/vault/api/vault-email": dial tcp: lookup hyper.media: no such host',
  Code.FailedPrecondition,
)

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  // Reuse the real shared queryClient defaults (useErrorBoundary: true, retry: 4)
  // so the hooks inherit the same app-wide behavior that triggers RootAppError.
  // Only shorten retry timing so the test does not wait ~30s for 4 retries.
  const defaults = queryClient.getDefaultOptions()
  queryClient.setDefaultOptions({
    ...defaults,
    queries: {...defaults.queries, retry: false, retryDelay: 1},
  })
  getVaultEmail.mockReset().mockRejectedValue(offlineError)
  getVaultPasswordStatus.mockReset().mockRejectedValue(offlineError)
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  queryClient.clear()
  container.remove()
  vi.restoreAllMocks()
})

function VaultEmailProbe() {
  const query = useVaultEmail()
  if (query.isError) return <div>VAULT_EMAIL_ERROR</div>
  if (query.isLoading) return <div>VAULT_EMAIL_LOADING</div>
  return <div>VAULT_EMAIL_DATA</div>
}

function VaultPasswordStatusProbe() {
  const query = useVaultPasswordStatus()
  if (query.isError) return <div>VAULT_PASSWORD_ERROR</div>
  if (query.isLoading) return <div>VAULT_PASSWORD_LOADING</div>
  return <div>VAULT_PASSWORD_DATA</div>
}

function renderProbe(probe: React.ReactNode) {
  act(() =>
    root.render(
      <QueryClientProvider client={queryClient}>
        <ErrorBoundary fallback={<div>BOUNDARY_FALLBACK</div>}>{probe}</ErrorBoundary>
      </QueryClientProvider>,
    ),
  )
}

describe('offline vault query errors', () => {
  test('useVaultEmail fails isolated without throwing into the ErrorBoundary', async () => {
    renderProbe(<VaultEmailProbe />)
    await vi.waitFor(() => {
      expect(container.textContent).toContain('VAULT_EMAIL_ERROR')
    })
    expect(container.textContent).not.toContain('BOUNDARY_FALLBACK')
  })

  test('useVaultPasswordStatus fails isolated without throwing into the ErrorBoundary', async () => {
    renderProbe(<VaultPasswordStatusProbe />)
    await vi.waitFor(() => {
      expect(container.textContent).toContain('VAULT_PASSWORD_ERROR')
    })
    expect(container.textContent).not.toContain('BOUNDARY_FALLBACK')
  })
})
