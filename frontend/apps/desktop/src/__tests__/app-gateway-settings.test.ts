import {queryKeys} from '@shm/shared/models/query-keys'
import {beforeEach, describe, expect, it, vi} from 'vitest'

const storeData: Record<string, any> = {}

const appStoreMock = {
  get: vi.fn((key: string) => storeData[key]),
  set: vi.fn((key: string, value: any) => {
    storeData[key] = value
  }),
}

const appInvalidateQueriesMock = vi.fn()
const handleNotifyServiceHostChangedMock = vi.fn()

vi.mock('../app-store.mts', () => ({
  appStore: appStoreMock,
}))

vi.mock('../app-invalidation', () => ({
  appInvalidateQueries: appInvalidateQueriesMock,
}))

vi.mock('../app-notification-read-state', () => ({
  handleNotifyServiceHostChanged: handleNotifyServiceHostChangedMock,
}))

async function loadCaller() {
  const mod = await import('../app-gateway-settings')
  return mod.gatewaySettingsApi.createCaller({})
}

describe('app gateway settings', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    for (const key of Object.keys(storeData)) delete storeData[key]
  })

  it('invalidates notify-related query groups and triggers read-state host handling when host changes', async () => {
    const caller = await loadCaller()

    await caller.setNotifyServiceHost('https://notify.example')

    expect(appStoreMock.set).toHaveBeenCalledWith('NotifyServiceHost', 'https://notify.example')
    expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.NOTIFY_SERVICE_HOST])
    expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.NOTIFICATION_CONFIG])
    expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.NOTIFICATION_READ_STATE])
    expect(appInvalidateQueriesMock).toHaveBeenCalledWith([queryKeys.NOTIFICATION_SYNC_STATUS])
    expect(handleNotifyServiceHostChangedMock).toHaveBeenCalledWith('https://notify.example')
  })

  it('does not invalidate or re-trigger read-state handling when host is unchanged', async () => {
    storeData.NotifyServiceHost = 'https://notify.same'
    const caller = await loadCaller()

    await caller.setNotifyServiceHost('https://notify.same')

    expect(appStoreMock.set).not.toHaveBeenCalled()
    expect(appInvalidateQueriesMock).not.toHaveBeenCalled()
    expect(handleNotifyServiceHostChangedMock).not.toHaveBeenCalled()
  })
})
