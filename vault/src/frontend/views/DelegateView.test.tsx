import * as blobs from '@shm/shared/blobs'
import {cleanup, render, screen} from '@testing-library/react'
import {afterEach, describe, expect, test} from 'bun:test'
import {MemoryRouter} from 'react-router-dom'
import {StoreContext, createStore} from '@/frontend/store'
import {createMockBlockstore, createMockClient} from '@/frontend/test-utils'
import {DelegateView} from './DelegateView'

function renderDelegateView({siteName, accountNames}: {siteName?: string; accountNames: string[]}) {
  const store = createStore(createMockClient(), createMockBlockstore())

  const accounts = accountNames.map((name, index) => {
    const kp = blobs.generateNobleKeyPair()
    // Pre-populate profiles so the view doesn't fetch them from the backend.
    store.state.profiles[blobs.principalToString(kp.principal)] = {name}
    return {seed: kp.seed, createTime: index, delegations: []}
  })

  store.state.decryptedDEK = new Uint8Array(32)
  store.state.vaultData = {version: 2, accounts}
  store.state.selectedAccountIndex = 0
  store.state.delegationRequest = {
    originalUrl: 'https://vault.example.com/delegate',
    clientId: 'https://site.example.com',
    redirectUri: 'https://site.example.com/callback',
    sessionKeyPrincipal: blobs.principalToString(blobs.generateNobleKeyPair().principal),
    state: 'AAAAAAAAAAAAAAAAAAAAAA',
    requestTs: Date.now(),
    proof: 'cA',
    vaultOrigin: 'https://vault.example.com',
    ...(siteName ? {siteName} : {}),
  }

  render(
    <MemoryRouter initialEntries={['/delegate']}>
      <StoreContext.Provider value={store}>
        <DelegateView />
      </StoreContext.Provider>
    </MemoryRouter>,
  )

  return store
}

describe('DelegateView', () => {
  afterEach(() => {
    cleanup()
  })

  test('shows the account reminder and "Continue as" even with a single account', () => {
    renderDelegateView({accountNames: ['Bea']})

    expect(screen.getByText('Confirm your account')).toBeDefined()
    expect(screen.getByText('Bea')).toBeDefined()
    expect(screen.getByRole('button', {name: 'Continue as Bea'})).toBeDefined()
    // The account picker heading only appears with more than one account.
    expect(screen.queryByText('Choose an account to use')).toBeNull()
  })

  test('shows the account picker heading with multiple accounts', () => {
    renderDelegateView({accountNames: ['Bea', 'Ana']})

    expect(screen.getByText('Choose an account to use')).toBeDefined()
    expect(screen.getByText('Bea')).toBeDefined()
    expect(screen.getByText('Ana')).toBeDefined()
    expect(screen.getByRole('button', {name: 'Continue as Bea'})).toBeDefined()
  })

  test('uses the requested site name in the description and keeps the origin visible', () => {
    renderDelegateView({siteName: 'Ethosfera', accountNames: ['Bea']})

    expect(screen.getByText('Ethosfera')).toBeDefined()
    expect(screen.getByText('site.example.com')).toBeDefined()
  })

  test('falls back to the client hostname when no site name is provided', () => {
    renderDelegateView({accountNames: ['Bea']})

    expect(screen.getByText('site.example.com')).toBeDefined()
  })
})
