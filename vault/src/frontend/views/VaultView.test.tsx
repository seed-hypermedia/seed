import {fireEvent, render, screen, waitFor} from '@testing-library/react'
import {describe, expect, mock, test} from 'bun:test'
import * as blobs from '@shm/shared/blobs'
import {MemoryRouter} from 'react-router-dom'
import {StoreContext, createStore} from '@/frontend/store'
import {createMockBlockstore, createSuccessMockClient} from '@/frontend/test-utils'
import {VaultView} from './VaultView'

describe('VaultView', () => {
  test('exports via modal and shows success message after download', async () => {
    const createObjectURL = mock(() => 'blob:export')
    const revokeObjectURL = mock(() => {})
    const click = mock(() => {})
    const append = mock(() => {})
    const remove = mock(() => {})
    const anchor = {
      click,
      remove,
      style: {display: ''},
      href: '',
      download: '',
    } as unknown as HTMLAnchorElement
    const originalCreateElement = document.createElement.bind(document)
    const originalAppend = document.body.append.bind(document.body)
    const originalCreateObjectURL = URL.createObjectURL.bind(URL)
    const originalRevokeObjectURL = URL.revokeObjectURL.bind(URL)
    const createElement = mock((tagName: string) => (tagName === 'a' ? anchor : originalCreateElement(tagName)))
    const seed = new Uint8Array(32).fill(9)
    const principal = blobs.principalToString(blobs.nobleKeyPairFromSeed(seed).principal)

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
          seed,
          createTime: 123456789,
          delegations: [],
        },
      ],
    }
    store.state.selectedAccountIndex = 0
    store.state.profiles[principal] = {name: 'Alice'}

    try {
      render(
        <MemoryRouter>
          <StoreContext.Provider value={store}>
            <VaultView />
          </StoreContext.Provider>
        </MemoryRouter>,
      )

      document.createElement = createElement as typeof document.createElement
      document.body.append = append as typeof document.body.append
      URL.createObjectURL = createObjectURL as typeof URL.createObjectURL
      URL.revokeObjectURL = revokeObjectURL as typeof URL.revokeObjectURL

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
      expect(createElement).toHaveBeenCalledWith('a')
      expect(anchor.download).toBe(`${principal}.hmkey.json`)
      expect(click).toHaveBeenCalled()
      expect(remove).toHaveBeenCalled()
      expect(revokeObjectURL).toHaveBeenCalledWith('blob:export')
      expect(screen.getByText(new RegExp(`Downloaded \`${principal}\\.hmkey\\.json\`\\.`, 'i'))).toBeDefined()
    } finally {
      document.createElement = originalCreateElement
      document.body.append = originalAppend
      URL.createObjectURL = originalCreateObjectURL
      URL.revokeObjectURL = originalRevokeObjectURL
    }
  })
})
