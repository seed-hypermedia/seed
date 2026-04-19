import {grpcClient} from '@/grpc-client'
import {client} from '@/trpc'
import {Code, ConnectError} from '@connectrpc/connect'
import {
  GenMnemonicResponse,
  GetVaultStatusResponse,
  Info,
  RegisterKeyRequest,
  StartVaultConnectionResponse,
} from '@shm/shared/client/.generated/daemon/v1alpha/daemon_pb'
import {GRPCClient} from '@shm/shared/grpc-client'
import {useResources} from '@shm/shared/models/entity'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {FetchQueryOptions, useMutation, UseMutationOptions, useQuery, UseQueryOptions} from '@tanstack/react-query'
import {useEffect, useRef, useState} from 'react'

export type NamedKey = {
  name: string
  accountId: string
  publicKey: string
}

// Default interval for daemon info polling (when no tasks are active)
const DEFAULT_DAEMON_INFO_INTERVAL = 10_000
// Fast interval for daemon info polling (when tasks are active)
const ACTIVE_TASKS_DAEMON_INFO_INTERVAL = 2_000
const VAULT_STATUS_POLL_INTERVAL = 10_000

export function invalidateVaultDependentQueries() {
  invalidateQueries([queryKeys.GET_VAULT_STATUS])
  invalidateQueries([queryKeys.LOCAL_ACCOUNT_ID_LIST])
}

export function getVaultStatusCacheBustKey(status: GetVaultStatusResponse | null | undefined) {
  if (!status) return null

  return [
    status.backendMode,
    status.connectionStatus,
    status.remoteVaultUrl,
    status.syncStatus?.localVersion?.toString() || '0',
    status.syncStatus?.remoteVersion?.toString() || '0',
  ].join(':')
}

function queryDaemonInfo(
  grpcClient: GRPCClient,
  opts: UseQueryOptions<Info | null> | FetchQueryOptions<Info | null> = {},
): UseQueryOptions<Info | null> | FetchQueryOptions<Info | null> {
  return {
    ...opts,
    queryKey: [queryKeys.GET_DAEMON_INFO],
    queryFn: async () => {
      try {
        return await grpcClient.daemon.getInfo({})
      } catch (error) {
        if (error) {
          console.log('error check make sure not set up condition..', error)
        }
      }
      return null
    },
    refetchInterval: DEFAULT_DAEMON_INFO_INTERVAL,
    useErrorBoundary: false,
  }
}

/**
 * Hook to get daemon info with smart polling.
 * Polls every 2s when there are active tasks, otherwise every 10s.
 */
export function useDaemonInfo(opts: UseQueryOptions<Info | null> = {}) {
  // Track whether we have active tasks to determine polling interval
  const [hasActiveTasks, setHasActiveTasks] = useState(false)

  const query = useQuery({
    queryKey: [queryKeys.GET_DAEMON_INFO],
    queryFn: async () => {
      try {
        return await grpcClient.daemon.getInfo({})
      } catch (error) {
        if (error) {
          console.log('error check make sure not set up condition..', error)
        }
      }
      return null
    },
    refetchInterval: hasActiveTasks ? ACTIVE_TASKS_DAEMON_INFO_INTERVAL : DEFAULT_DAEMON_INFO_INTERVAL,
    useErrorBoundary: false,
    ...opts,
  })

  // Update hasActiveTasks based on query data
  useEffect(() => {
    const tasksCount = query.data?.tasks?.length ?? 0
    setHasActiveTasks(tasksCount > 0)
  }, [query.data?.tasks?.length])

  return query
}

/**
 * Returns daemon vault backend and remote-sync status metadata.
 */
export function useVaultStatus(opts: UseQueryOptions<GetVaultStatusResponse | null> = {}) {
  const query = useQuery({
    queryKey: [queryKeys.GET_VAULT_STATUS],
    queryFn: async () => {
      try {
        return await grpcClient.daemon.getVaultStatus({})
      } catch (error) {
        if (error) {
          console.error('useVaultStatus failed:', error)
        }
      }
      return null
    },
    refetchInterval: VAULT_STATUS_POLL_INTERVAL,
    useErrorBoundary: false,
    ...opts,
  })

  const cacheBustKey = getVaultStatusCacheBustKey(query.data)
  const previousCacheBustKey = useRef<string | null>(null)

  useEffect(() => {
    if (!cacheBustKey) return
    if (previousCacheBustKey.current && previousCacheBustKey.current !== cacheBustKey) {
      invalidateQueries([queryKeys.LOCAL_ACCOUNT_ID_LIST])
    }
    previousCacheBustKey.current = cacheBustKey
  }, [cacheBustKey])

  return query
}

/** Input parameters for starting a daemon-managed remote vault connection flow. */
export type StartVaultConnectionInput = {
  vaultUrl: string
  force?: boolean
}

/** Starts daemon remote vault connection handoff and returns browser handoff metadata. */
export function useStartVaultConnection(
  opts?: UseMutationOptions<StartVaultConnectionResponse, unknown, StartVaultConnectionInput>,
) {
  return useMutation({
    ...opts,
    mutationFn: async ({vaultUrl, force = false}) => {
      return await grpcClient.daemon.startVaultConnection({vaultUrl, force})
    },
    onSuccess: async (data, variables, context) => {
      invalidateVaultDependentQueries()
      opts?.onSuccess?.(data, variables, context)
    },
  })
}

/** Disconnects daemon remote vault mode and returns to local backend mode. */
export function useDisconnectVault(opts?: UseMutationOptions<void, unknown, void>) {
  return useMutation({
    ...opts,
    mutationFn: async () => {
      await grpcClient.daemon.disconnectVault({})
    },
    onSuccess: async (data, variables, context) => {
      invalidateVaultDependentQueries()
      opts?.onSuccess?.(data, variables, context)
    },
  })
}

/** Forces an immediate sync with the remote vault. Returns error if remote is not configured or offline. */
export function useForceVaultSync(opts?: UseMutationOptions<GetVaultStatusResponse, unknown, void>) {
  return useMutation({
    ...opts,
    mutationFn: async () => {
      return await grpcClient.daemon.getVaultStatus({forceSync: true})
    },
    onSuccess: async (data, variables, context) => {
      invalidateVaultDependentQueries()
      opts?.onSuccess?.(data, variables, context)
    },
  })
}

export function useMnemonics(opts?: UseQueryOptions<GenMnemonicResponse['mnemonic']>) {
  return useQuery({
    queryKey: [queryKeys.GENERATE_MNEMONIC],
    queryFn: async () => {
      const data = await grpcClient.daemon.genMnemonic({})
      return data.mnemonic
    },
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    ...opts,
  })
}

export function useMyAccountIds() {
  return useQuery({
    queryKey: [queryKeys.LOCAL_ACCOUNT_ID_LIST],
    queryFn: async () => {
      try {
        const q = await grpcClient.daemon.listKeys({})
        return [...q?.keys]
          .sort((a, b) => {
            // alphabetical based on public key:
            return a.accountId.localeCompare(b.accountId)
            // ideally we would sort based on creation time, but that is not available with this data
          })
          .map((k) => k.publicKey)
      } catch (e) {
        const connectError = ConnectError.from(e)
        console.error(`useMyAccountIds error code ${Code[connectError.code]}: ${JSON.stringify(connectError.message)}`)
        return []
      }
    },
  })
}

export function useMyAccounts() {
  const {data = []} = useMyAccountIds()
  return useResources(data?.map((k) => hmId(k)))
}

/**
 * Returns the daemon key records available on this device.
 */
export function useListKeys(opts: UseQueryOptions<NamedKey[]> = {}) {
  return useQuery({
    queryKey: [queryKeys.LOCAL_ACCOUNT_ID_LIST, 'keys'],
    queryFn: async () => {
      const q = await grpcClient.daemon.listKeys({})
      return [...q.keys].sort((a, b) => a.accountId.localeCompare(b.accountId))
    },
    ...opts,
  })
}

export function useRegisterKey(
  opts?: UseMutationOptions<
    NamedKey,
    unknown,
    {
      mnemonic: RegisterKeyRequest['mnemonic']
      name?: RegisterKeyRequest['name']
      passphrase?: RegisterKeyRequest['passphrase']
    }
  >,
) {
  return useMutation({
    ...opts,
    mutationFn: async ({name = '', mnemonic, passphrase}) => {
      const registration = await grpcClient.daemon.registerKey({
        name,
        mnemonic,
        passphrase,
      })
      grpcClient.subscriptions
        .subscribe({
          account: registration.publicKey,
          recursive: true,
          path: '',
        })
        .catch((e) => {
          console.error('Failed to subscribe to new account!', e)
        })
        .then(() => {
          console.log('Subscribed to new account')
        })
      return registration
    },
    onSuccess: () => {
      invalidateQueries([queryKeys.LOCAL_ACCOUNT_ID_LIST])
    },
  })
}

/**
 * Imports an existing account key from a daemon-readable file path.
 */
export function useImportKey(opts?: UseMutationOptions<NamedKey, unknown, {filePath: string; password?: string}>) {
  return useMutation({
    ...opts,
    mutationFn: async ({filePath, password}) => {
      const registration = await grpcClient.daemon.importKey({
        filePath,
        password,
      })

      grpcClient.subscriptions
        .subscribe({
          account: registration.publicKey,
          recursive: true,
          path: '',
        })
        .catch((e) => {
          console.error('Failed to subscribe to imported account!', e)
        })
        .then(() => {
          console.log('Subscribed to imported account')
        })

      return registration
    },
    onSuccess: () => {
      invalidateQueries([queryKeys.LOCAL_ACCOUNT_ID_LIST])
    },
  })
}

/**
 * Exports an existing account key to a daemon-writable file path.
 */
export function useExportKey(
  opts?: UseMutationOptions<void, unknown, {name: string; filePath: string; password?: string}>,
) {
  return useMutation({
    ...opts,
    mutationFn: async ({name, filePath, password}) => {
      await grpcClient.daemon.exportKey({
        name,
        filePath,
        password,
      })
    },
  })
}

export function useDeleteKey(opts?: UseMutationOptions<any, unknown, {accountId: string}>) {
  return useMutation({
    mutationFn: async ({accountId}) => {
      // Use TRPC to handle the entire deletion process on the backend
      return await client.deleteAccount.mutate(accountId)
    },
    onSuccess: async (data, variables, context) => {
      invalidateQueries([queryKeys.LOCAL_ACCOUNT_ID_LIST])

      // Call the original onSuccess if provided
      if (opts?.onSuccess) {
        opts.onSuccess(data, variables, context)
      }
    },
    ...opts,
  })
}

export function useSavedMnemonics(name: NamedKey['name'] | undefined) {
  return useQuery({
    queryKey: [queryKeys.SECURE_STORAGE, name],
    queryFn: () => client.secureStorage.read.query(name),
    enabled: !!name,
  })
}
