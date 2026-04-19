import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {VaultBackendMode, VaultConnectionStatus} from '@shm/shared/client/.generated/daemon/v1alpha/daemon_pb'

const mockState = vi.hoisted(() => ({
  vaultStatusData: null as any,
  keys: [] as Array<{publicKey: string}>,
  reminderPreference: {
    remindLaterUntilMs: null as number | null,
    dontRemindAgain: false,
  },
  setPreference: vi.fn(),
  navigate: vi.fn(),
}))

vi.mock('@/models/daemon', () => ({
  useVaultStatus: () => ({
    data: mockState.vaultStatusData,
  }),
  useListKeys: () => ({
    data: mockState.keys,
  }),
}))

vi.mock('@/models/app-settings', () => ({
  useRemoteVaultReminderPreference: () => ({
    value: {
      data: mockState.reminderPreference,
    },
    setPreference: mockState.setPreference,
  }),
}))

vi.mock('@/utils/useNavigate', () => ({
  useNavigate: () => mockState.navigate,
}))

import {RemoteVaultReminder} from '../components/remote-vault-reminder'

function renderComponent() {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(<RemoteVaultReminder />)
  })
  return {container, root}
}

function cleanupRendered(root: Root, container: HTMLDivElement) {
  act(() => {
    root.unmount()
  })
  container.remove()
}

function findButton(container: HTMLDivElement, label: string) {
  return Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes(label)) as
    | HTMLButtonElement
    | undefined
}

describe('RemoteVaultReminder', () => {
  beforeEach(() => {
    ;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    mockState.vaultStatusData = {
      backendMode: VaultBackendMode.LOCAL,
      connectionStatus: VaultConnectionStatus.DISCONNECTED,
    }
    mockState.keys = [{publicKey: 'acc-1'}]
    mockState.reminderPreference = {
      remindLaterUntilMs: null,
      dontRemindAgain: false,
    }
    mockState.setPreference.mockReset()
    mockState.navigate.mockReset()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('shows the reminder for local-only users with keys', () => {
    const {container, root} = renderComponent()

    expect(container.textContent).toContain('Connect a Remote Vault')
    expect(container.textContent).toContain('Open Settings')
    expect(container.textContent).toContain('Remind Me Later')
    expect(container.textContent).toContain("Don't Remind Again")

    cleanupRendered(root, container)
  })

  it('hides the reminder when remote vault is already connected', () => {
    mockState.vaultStatusData = {
      backendMode: VaultBackendMode.REMOTE,
      connectionStatus: VaultConnectionStatus.CONNECTED,
    }

    const {container, root} = renderComponent()

    expect(container.textContent).toBe('')

    cleanupRendered(root, container)
  })

  it('hides the reminder while snoozed', () => {
    mockState.reminderPreference = {
      remindLaterUntilMs: Date.now() + 60_000,
      dontRemindAgain: false,
    }

    const {container, root} = renderComponent()

    expect(container.textContent).toBe('')

    cleanupRendered(root, container)
  })

  it("hides the reminder after don't remind again is set", () => {
    mockState.reminderPreference = {
      remindLaterUntilMs: null,
      dontRemindAgain: true,
    }

    const {container, root} = renderComponent()

    expect(container.textContent).toBe('')

    cleanupRendered(root, container)
  })

  it('hides the reminder when there are no local accounts yet', () => {
    mockState.keys = []

    const {container, root} = renderComponent()

    expect(container.textContent).toBe('')

    cleanupRendered(root, container)
  })

  it('opens settings from the reminder', async () => {
    const {container, root} = renderComponent()

    await act(async () => {
      findButton(container, 'Open Settings')?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
    })

    expect(mockState.navigate).toHaveBeenCalledWith({key: 'settings'})

    cleanupRendered(root, container)
  })

  it('snoozes the reminder when remind me later is clicked', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    const {container, root} = renderComponent()

    await act(async () => {
      findButton(container, 'Remind Me Later')?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
    })

    expect(mockState.setPreference).toHaveBeenCalledWith({
      remindLaterUntilMs: 1_700_604_800_000,
      dontRemindAgain: false,
    })

    vi.restoreAllMocks()
    cleanupRendered(root, container)
  })

  it("stops future reminders when don't remind again is clicked", async () => {
    const {container, root} = renderComponent()

    await act(async () => {
      findButton(container, "Don't Remind Again")?.dispatchEvent(new MouseEvent('click', {bubbles: true}))
      await Promise.resolve()
    })

    expect(mockState.setPreference).toHaveBeenCalledWith({
      remindLaterUntilMs: null,
      dontRemindAgain: true,
    })

    cleanupRendered(root, container)
  })
})
