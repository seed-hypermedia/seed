import {StoreContext, createStore} from '@/frontend/store'
import {createMockBlockstore, createSuccessMockClient} from '@/frontend/test-utils'
import * as keyfile from '@seed-hypermedia/client/keyfile'
import * as blobs from '@shm/shared/blobs'
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react'
import {afterEach, expect, mock, test} from 'bun:test'
import {useState} from 'react'
import {ImportAccountDialog} from './ImportAccountDialog'

const words = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const principal = 'z6MkqqiSjqcT9NasDUXiymyB8kpgz6h3CNQaghGAoXsaYJ2f'

afterEach(cleanup)

function setup(overrides: Parameters<typeof createSuccessMockClient>[0] = {}) {
  const store = createStore(createSuccessMockClient(overrides), createMockBlockstore())
  store.state.decryptedDEK = new Uint8Array(32)
  store.state.vaultLoaded = true
  store.state.vaultData = {version: 2, accounts: []}
  let resolveImported!: (principal: string) => void
  const imported = new Promise<string>((resolve) => {
    resolveImported = resolve
  })
  const onImported = mock((principal: string) => {
    resolveImported(principal)
  })
  function Harness() {
    const [open, setOpen] = useState(true)
    return (
      <StoreContext.Provider value={store}>
        <button onClick={() => setOpen(true)}>Open import</button>
        <ImportAccountDialog open={open} onOpenChange={setOpen} onImported={onImported} />
      </StoreContext.Provider>
    )
  }
  render(<Harness />)
  return {store, onImported, imported}
}

function pasteWords(text: string) {
  fireEvent.paste(screen.getByLabelText('Recovery word 1'), {clipboardData: {getData: () => text}})
}

function choosePhrase() {
  fireEvent.mouseDown(screen.getByRole('tab', {name: 'Recovery phrase'}), {button: 0, ctrlKey: false})
}

test('imports recovery words and closes the dialog on success', async () => {
  const {store, onImported} = setup()
  choosePhrase()
  pasteWords(words)
  fireEvent.click(screen.getByRole('button', {name: 'Import account'}))
  await waitFor(() => expect(onImported).toHaveBeenCalledWith(principal))
  expect(store.state.vaultData!.accounts).toHaveLength(1)
  expect(screen.queryByRole('dialog')).toBeNull()
})

test('shows invalid-phrase errors inside the dialog and allows correction', async () => {
  const {onImported} = setup()
  choosePhrase()
  pasteWords(Array(12).fill('invalid').join(' '))
  fireEvent.click(screen.getByRole('button', {name: 'Import account'}))
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Invalid account recovery phrase'))
  expect(onImported).not.toHaveBeenCalled()
  pasteWords(words)
  expect(screen.queryByRole('alert')).toBeNull()
  fireEvent.click(screen.getByRole('button', {name: 'Import account'}))
  await waitFor(() => expect(onImported).toHaveBeenCalledWith(principal))
})

test('passes the original passphrase unchanged', async () => {
  const {store, onImported} = setup()
  choosePhrase()
  pasteWords(words)
  fireEvent.change(screen.getByLabelText('Passphrase (optional)'), {target: {value: ' secret '}})
  fireEvent.click(screen.getByRole('button', {name: 'Import account'}))
  await waitFor(() => expect(onImported).toHaveBeenCalledTimes(1))
  expect(Buffer.from(store.state.vaultData!.accounts[0]!.seed).toString('hex')).toBe(
    'a3c56832d2b3976001e050c7e9ab0888fee4db25b1c9b1dfc9207d7b8ff9ff75',
  )
})

test('clears secrets when switching methods and closing the dialog', () => {
  setup()
  choosePhrase()
  pasteWords(words)
  fireEvent.change(screen.getByLabelText('Passphrase (optional)'), {target: {value: 'secret'}})
  fireEvent.mouseDown(screen.getByRole('tab', {name: 'Key file'}), {button: 0, ctrlKey: false})
  choosePhrase()
  expect((screen.getByLabelText('Recovery word 1') as HTMLInputElement).value).toBe('')
  expect((screen.getByLabelText('Passphrase (optional)') as HTMLInputElement).value).toBe('')
  pasteWords(words)
  fireEvent.click(screen.getByRole('button', {name: 'Cancel'}))
  fireEvent.click(screen.getByRole('button', {name: 'Open import'}))
  choosePhrase()
  expect((screen.getByLabelText('Recovery word 1') as HTMLInputElement).value).toBe('')
})

test('prevents duplicate submissions and dismissal while saving', async () => {
  let finish!: () => void
  const pending = new Promise<void>((resolve) => {
    finish = resolve
  })
  const saveVault = mock(async () => {
    await pending
    return {success: true}
  })
  const {onImported} = setup({saveVault})
  choosePhrase()
  pasteWords(words)
  fireEvent.click(screen.getByRole('button', {name: 'Import account'}))
  await waitFor(() => expect(saveVault).toHaveBeenCalledTimes(1))
  expect((screen.getByRole('button', {name: 'Importing…'}) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('button', {name: 'Cancel'}) as HTMLButtonElement).disabled).toBe(true)
  expect((screen.getByRole('tab', {name: 'Key file'}) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.keyDown(screen.getByRole('dialog'), {key: 'Escape'})
  expect(screen.queryByRole('dialog')).not.toBeNull()
  await act(async () => finish())
  await waitFor(() => expect(onImported).toHaveBeenCalledWith(principal))
})

test('continues to import encrypted key files', async () => {
  const {onImported, imported} = setup()
  const kp = blobs.generateNobleKeyPair()
  const publicKey = blobs.principalToString(kp.principal)
  const payload = await keyfile.create({publicKey, key: kp.seed, password: 'password'})
  fireEvent.change(screen.getByLabelText('Key file', {selector: 'input'}), {
    target: {files: [new File([keyfile.stringify(payload)], 'test.hmkey.json')]},
  })
  fireEvent.change(screen.getByLabelText('Password (optional)'), {target: {value: 'password'}})
  await act(async () => {
    fireEvent.click(screen.getByRole('button', {name: 'Import account'}))
    await imported
  })
  expect(onImported).toHaveBeenCalledWith(publicKey)
})

test('requires every recovery word and supports typing longer phrases', () => {
  setup()
  choosePhrase()
  expect(screen.getAllByRole('textbox')).toHaveLength(12)
  expect((screen.getByRole('button', {name: 'Import account'}) as HTMLButtonElement).disabled).toBe(true)
  pasteWords(words)
  expect((screen.getByRole('button', {name: 'Import account'}) as HTMLButtonElement).disabled).toBe(false)
  fireEvent.change(screen.getByLabelText('Recovery word 5'), {target: {value: ''}})
  expect((screen.getByRole('button', {name: 'Import account'}) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('Word count'), {target: {value: '24'}})
  expect(screen.getAllByRole('textbox')).toHaveLength(24)
  expect((screen.getByLabelText('Recovery word 1') as HTMLInputElement).value).toBe('abandon')
})

test('automatically expands and imports a pasted 24-word phrase', async () => {
  const {store, imported} = setup()
  choosePhrase()
  pasteWords(`${Array(23).fill('abandon').join(' ')} art`)
  expect(screen.getAllByRole('textbox')).toHaveLength(24)
  expect((screen.getByLabelText('Recovery word 24') as HTMLInputElement).value).toBe('art')
  await act(async () => {
    fireEvent.click(screen.getByRole('button', {name: 'Import account'}))
    await imported
  })
  expect(store.state.vaultData!.accounts).toHaveLength(1)
})

test('an overflowing paste cannot accidentally import the previous phrase', () => {
  const {onImported} = setup()
  choosePhrase()
  pasteWords(words)
  pasteWords(Array(25).fill('abandon').join(' '))
  expect(screen.getByRole('alert').textContent).toContain('Too many words')
  expect((screen.getByRole('button', {name: 'Import account'}) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.submit(screen.getByRole('button', {name: 'Import account'}).closest('form')!)
  expect(onImported).not.toHaveBeenCalled()
  pasteWords(words)
  expect(screen.queryByRole('alert')).toBeNull()
  expect((screen.getByRole('button', {name: 'Import account'}) as HTMLButtonElement).disabled).toBe(false)
})
