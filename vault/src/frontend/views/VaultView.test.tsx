import {fireEvent, render, screen, waitFor} from '@testing-library/react'
import {describe, expect, spyOn, test} from 'bun:test'
import {MemoryRouter} from 'react-router-dom'
import {StoreContext, createStore} from '@/frontend/store'
import {createMockBlockstore, createSuccessMockClient} from '@/frontend/test-utils'
import * as keyExport from '@/frontend/key-export'
import {VaultView} from './VaultView'

describe('VaultView', () => {
  test('exports via modal and shows success message after download', async () => {
    const exportSpy = spyOn(keyExport, 'saveAccountKeyFile').mockResolvedValue({
      fileName: 'alice.hmkey.json',
      method: 'download',
    })
    const store = createStore(createSuccessMockClient(), createMockBlockstore(), 'https://daemon.example.com')
    store.state.sessionChecked = true
    store.state.session = {
      authenticated: true,
      relyingPartyOrigin: 'https://vault.example.com',
      email: 'test@example.com',
    }
    store.state.decryptedDEK = new Uint8Array(32)
    store.state.vaultData = {
      version: 2,
      accounts: [
        {
          seed: new Uint8Array(32).fill(9),
          createTime: 123456789,
          delegations: [],
        },
      ],
    }
    store.state.selectedAccountIndex = 0
    const principal = 'z6MkhaXgBZDvotDkL95PYN7gScR7Rz9V5E7MBiCWDm6VFjVm'
    store.state.profiles[principal] = {name: 'Alice'}

    render(
      <MemoryRouter>
        <StoreContext.Provider value={store}>
          <VaultView />
        </StoreContext.Provider>
      </MemoryRouter>,
    )

    expect(screen.queryByText('Security Warning')).toBeNull()

    fireEvent.click(screen.getByRole('button', {name: 'Export Key'}))

    await waitFor(() => {
      expect(screen.getByText('Security Warning')).toBeDefined()
    })
    expect(screen.getByLabelText('Password (optional)')).toBeDefined()

    fireEvent.click(screen.getByRole('button', {name: 'Export Key'}))

    await waitFor(() => {
      expect(screen.getByText('Key Exported')).toBeDefined()
    })
    expect(exportSpy).toHaveBeenCalled()
    expect(screen.getByText(/Downloaded `alice.hmkey.json`./i)).toBeDefined()
  })
})
