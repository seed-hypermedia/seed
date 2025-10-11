import {grpcClient} from '@/grpc-client'
import {trpc} from '@/trpc'
import {Code, ConnectError} from '@connectrpc/connect'
import {
  GenMnemonicResponse,
  Info,
  RegisterKeyRequest,
} from '@shm/shared/client/.generated/daemon/v1alpha/daemon_pb'
import {GRPCClient} from '@shm/shared/grpc-client'
import {useResources} from '@shm/shared/models/entity'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {
  FetchQueryOptions,
  useMutation,
  UseMutationOptions,
  useQuery,
  UseQueryOptions,
} from '@tanstack/react-query'
import {useEffect, useState} from 'react'

export type NamedKey = {
  name: string
  accountId: string
  publicKey: string
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
    refetchInterval: 10_000,
    useErrorBoundary: false,
  }
}
export function useDaemonInfo(opts: UseQueryOptions<Info | null> = {}) {
  return useQuery(queryDaemonInfo(grpcClient, opts))
}

export function useMnemonics(
  opts?: UseQueryOptions<GenMnemonicResponse['mnemonic']>,
) {
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
        console.error(
          `useMyAccountIds error code ${
            Code[connectError.code]
          }: ${JSON.stringify(connectError.message)}`,
        )
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
 * Returns a list of keys from the daemon.
 * This is a hook that is used to list keys from the daemon.
 * It is used to check if the user has any accounts.
 * If the user has no accounts, it will show the onboarding screen.
 * If the user has accounts, it will show the main app.
 *
 * @returns
 */
export function useListKeys() {
  const [keys, setKeys] = useState<NamedKey[]>([])
  useEffect(() => {
    keys()

    async function keys() {
      try {
        const q = await grpcClient.daemon.listKeys({})
        setKeys([...q?.keys])
      } catch (e) {
        console.error('Failed to list keys', e)
      }
    }
  }, [])

  return keys
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
          path: '/',
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

export function useDeleteKey(
  opts?: UseMutationOptions<any, unknown, {accountId: string}>,
) {
  const deleteAccount = trpc.deleteAccount.useMutation()
  return useMutation({
    mutationFn: async ({accountId}) => {
      // Use TRPC to handle the entire deletion process on the backend
      return await deleteAccount.mutateAsync(accountId)
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
  return trpc.secureStorage.read.useQuery(name, {
    enabled: !!name,
  })
}
