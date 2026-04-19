import {beforeEach, describe, expect, it, vi} from 'vitest'

const storeData: Record<string, any> = {}
const ipcHandlers = new Map<string, (...args: any[]) => void>()

const ipcMainMock = {
  on: vi.fn((channel: string, handler: (...args: any[]) => void) => {
    ipcHandlers.set(channel, handler)
  }),
}

const appStoreMock = {
  get: vi.fn((key: string) => storeData[key]),
  set: vi.fn((key: string, value: any) => {
    storeData[key] = value
  }),
}

vi.mock('electron', () => ({
  ipcMain: ipcMainMock,
}))

vi.mock('../app-store.mjs', () => ({
  appStore: appStoreMock,
}))

async function loadModule() {
  return await import('../app-onboarding-store')
}

describe('app onboarding store', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    ipcHandlers.clear()
    for (const key of Object.keys(storeData)) delete storeData[key]
  })

  it('hydrates only durable onboarding fields from disk', async () => {
    storeData['onboarding-v001'] = {
      hasCompletedOnboarding: true,
      hasSkippedOnboarding: false,
      initialAccountIdCount: 7,
      currentStep: 'import',
      formData: {
        name: 'Stale Name',
      },
    }

    const mod = await loadModule()

    expect(mod.getOnboardingState()).toEqual({
      hasCompletedOnboarding: true,
      hasSkippedOnboarding: false,
      currentStep: 'welcome',
      formData: {
        name: '',
      },
      initialAccountIdCount: 7,
    })
  })

  it('keeps transient wizard state only in memory across reloads', async () => {
    const mod = await loadModule()

    mod.setOnboardingState({
      currentStep: 'vault',
      formData: {
        name: 'Alice',
      },
      initialAccountIdCount: 3,
    })

    expect(mod.getOnboardingState()).toEqual({
      hasCompletedOnboarding: false,
      hasSkippedOnboarding: false,
      currentStep: 'vault',
      formData: {
        name: 'Alice',
      },
      initialAccountIdCount: 3,
    })

    expect(appStoreMock.set).toHaveBeenLastCalledWith('onboarding-v001', {
      hasCompletedOnboarding: false,
      hasSkippedOnboarding: false,
      initialAccountIdCount: 3,
    })

    vi.resetModules()
    const reloadedModule = await loadModule()

    expect(reloadedModule.getOnboardingState()).toEqual({
      hasCompletedOnboarding: false,
      hasSkippedOnboarding: false,
      currentStep: 'welcome',
      formData: {
        name: '',
      },
      initialAccountIdCount: 3,
    })
  })

  it('registers IPC handlers that expose in-memory state while persisting only durable fields', async () => {
    const mod = await loadModule()

    mod.setupOnboardingHandlers()

    expect(ipcMainMock.on).toHaveBeenCalledWith('get-onboarding-state', expect.any(Function))
    expect(ipcMainMock.on).toHaveBeenCalledWith('set-onboarding-step', expect.any(Function))
    expect(ipcMainMock.on).toHaveBeenCalledWith('set-onboarding-form-data', expect.any(Function))
    expect(ipcMainMock.on).toHaveBeenCalledWith('set-onboarding-completed', expect.any(Function))

    ipcHandlers.get('set-onboarding-step')?.({}, 'import')
    ipcHandlers.get('set-onboarding-form-data')?.({}, {name: 'Bob'})
    ipcHandlers.get('set-onboarding-completed')?.({}, true)

    const event = {returnValue: undefined as any}
    ipcHandlers.get('get-onboarding-state')?.(event)

    expect(event.returnValue).toEqual({
      hasCompletedOnboarding: true,
      hasSkippedOnboarding: false,
      currentStep: 'import',
      formData: {
        name: 'Bob',
      },
      initialAccountIdCount: 0,
    })

    expect(appStoreMock.set).toHaveBeenLastCalledWith('onboarding-v001', {
      hasCompletedOnboarding: true,
      hasSkippedOnboarding: false,
      initialAccountIdCount: 0,
    })
  })
})
