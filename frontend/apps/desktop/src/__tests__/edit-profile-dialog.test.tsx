import React from 'react'
import {createRoot, Root} from 'react-dom/client'
;(globalThis as typeof globalThis & {React?: typeof React}).React = React
import {act} from 'react-dom/test-utils'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const updateProfileMock = vi.hoisted(() => vi.fn())
const fileUploadMock = vi.hoisted(() => vi.fn())
const invalidateQueriesMock = vi.hoisted(() => vi.fn())
const useAccountMock = vi.hoisted(() => vi.fn())
const toastSuccessMock = vi.hoisted(() => vi.fn())
const capturedFormProps = vi.hoisted(() => ({current: null as any}))

vi.mock('@/grpc-client', () => ({
  grpcClient: {
    documents: {
      updateProfile: updateProfileMock,
    },
  },
}))

vi.mock('@/utils/file-upload', () => ({
  fileUpload: fileUploadMock,
}))

vi.mock('@shm/shared', () => ({
  queryKeys: {
    ACCOUNT: 'ACCOUNT',
    LIST_ACCOUNTS: 'LIST_ACCOUNTS',
  },
}))

vi.mock('@shm/shared/models/entity', () => ({
  useAccount: useAccountMock,
}))

vi.mock('@shm/shared/models/query-client', () => ({
  invalidateQueries: invalidateQueriesMock,
}))

vi.mock('@shm/ui/components/dialog', async () => {
  const React = await import('react')
  return {
    DialogTitle: ({children}: {children: React.ReactNode}) =>
      React.createElement('h2', {'data-testid': 'dialog-title'}, children),
  }
})

vi.mock('@shm/ui/edit-profile-form', async () => {
  const React = await import('react')
  return {
    EditProfileForm: (props: any) => {
      capturedFormProps.current = props
      return React.createElement('div', {'data-testid': 'edit-profile-form'})
    },
  }
})

vi.mock('@shm/ui/spinner', async () => {
  const React = await import('react')
  return {
    Spinner: () => React.createElement('div', {'data-testid': 'spinner'}),
  }
})

vi.mock('@shm/ui/toast', () => ({
  toast: {
    success: toastSuccessMock,
  },
}))

vi.mock('@shm/ui/universal-dialog', () => ({
  useAppDialog: vi.fn(),
}))

import {EditProfileDialog} from '../components/edit-profile-dialog'

const ACCOUNT_UID = 'z6MkaccountExampleUid'

function renderDialog(onClose: () => void) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  const queryClient = new QueryClient({
    defaultOptions: {queries: {retry: false}},
  })

  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <EditProfileDialog onClose={onClose} input={{accountUid: ACCOUNT_UID}} />
      </QueryClientProvider>,
    )
  })

  return {container, root, queryClient}
}

function cleanup(root: Root, container: HTMLDivElement, queryClient: QueryClient) {
  act(() => {
    root.unmount()
  })
  queryClient.clear()
  container.remove()
}

describe('EditProfileDialog', () => {
  beforeEach(() => {
    ;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true
    updateProfileMock.mockReset()
    updateProfileMock.mockResolvedValue(undefined)
    fileUploadMock.mockReset()
    invalidateQueriesMock.mockReset()
    useAccountMock.mockReset()
    toastSuccessMock.mockReset()
    capturedFormProps.current = null
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('calls UpdateProfile RPC with current name, existing ipfs icon, and preserved description on submit', async () => {
    useAccountMock.mockReturnValue({
      isLoading: false,
      data: {
        metadata: {
          name: 'Old Name',
          icon: 'ipfs://oldiconcid',
          summary: 'Existing description',
        },
      },
    })

    const onClose = vi.fn()
    const {container, root, queryClient} = renderDialog(onClose)

    expect(capturedFormProps.current).not.toBeNull()
    expect(capturedFormProps.current.defaultValues).toEqual({
      name: 'Old Name',
      icon: 'ipfs://oldiconcid',
    })

    await act(async () => {
      await capturedFormProps.current.onSubmit({name: 'New Name', icon: 'ipfs://oldiconcid'})
    })

    expect(fileUploadMock).not.toHaveBeenCalled()
    expect(updateProfileMock).toHaveBeenCalledTimes(1)
    expect(updateProfileMock).toHaveBeenCalledWith({
      account: ACCOUNT_UID,
      profile: {
        name: 'New Name',
        icon: 'ipfs://oldiconcid',
        description: 'Existing description',
      },
      signingKeyName: ACCOUNT_UID,
    })
    expect(invalidateQueriesMock).toHaveBeenCalledWith(['ACCOUNT', ACCOUNT_UID])
    expect(invalidateQueriesMock).toHaveBeenCalledWith(['LIST_ACCOUNTS'])
    expect(toastSuccessMock).toHaveBeenCalledWith('Profile updated')
    expect(onClose).toHaveBeenCalledTimes(1)

    cleanup(root, container, queryClient)
  })

  it('uploads a new icon blob and passes the resulting ipfs URI', async () => {
    useAccountMock.mockReturnValue({
      isLoading: false,
      data: {
        metadata: {
          name: 'Alice',
          icon: '',
          summary: '',
        },
      },
    })
    fileUploadMock.mockResolvedValue('newcid123')

    const onClose = vi.fn()
    const {container, root, queryClient} = renderDialog(onClose)

    const blob = new Blob([new Uint8Array([1, 2, 3])], {type: 'image/png'})
    await act(async () => {
      await capturedFormProps.current.onSubmit({name: 'Alice', icon: blob})
    })

    expect(fileUploadMock).toHaveBeenCalledTimes(1)
    const uploadedFile = fileUploadMock.mock.calls[0][0]
    expect(uploadedFile).toBeInstanceOf(File)
    expect((uploadedFile as File).name).toBe('icon')

    expect(updateProfileMock).toHaveBeenCalledWith({
      account: ACCOUNT_UID,
      profile: {
        name: 'Alice',
        icon: 'ipfs://newcid123',
        description: '',
      },
      signingKeyName: ACCOUNT_UID,
    })

    cleanup(root, container, queryClient)
  })

  it('passes an empty icon string when no icon is set', async () => {
    useAccountMock.mockReturnValue({
      isLoading: false,
      data: {
        metadata: {
          name: '',
          icon: undefined,
          summary: undefined,
        },
      },
    })

    const onClose = vi.fn()
    const {container, root, queryClient} = renderDialog(onClose)

    await act(async () => {
      await capturedFormProps.current.onSubmit({name: 'Bob', icon: null})
    })

    expect(fileUploadMock).not.toHaveBeenCalled()
    expect(updateProfileMock).toHaveBeenCalledWith({
      account: ACCOUNT_UID,
      profile: {name: 'Bob', icon: '', description: ''},
      signingKeyName: ACCOUNT_UID,
    })

    cleanup(root, container, queryClient)
  })

  it('renders spinner while account is loading', () => {
    useAccountMock.mockReturnValue({isLoading: true, data: undefined})

    const {container, root, queryClient} = renderDialog(() => {})

    expect(container.querySelector('[data-testid="spinner"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="edit-profile-form"]')).toBeNull()

    cleanup(root, container, queryClient)
  })
})
