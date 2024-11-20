import {useGRPCClient} from '@/app-context'
import {Code, ConnectError} from '@connectrpc/connect'
import {invalidateQueries, queryKeys} from '@shm/shared'

import {trpc} from '@/trpc'
import {
  GenMnemonicResponse,
  GRPCClient,
  hmId,
  Info,
  RegisterKeyRequest,
} from '@shm/shared'
import {
  FetchQueryOptions,
  useMutation,
  UseMutationOptions,
  useQuery,
  UseQueryOptions,
} from '@tanstack/react-query'
import {useEntities} from './entities'

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
  const grpcClient = useGRPCClient()
  return useQuery(queryDaemonInfo(grpcClient, opts))
}

export function useMnemonics(
  opts?: UseQueryOptions<GenMnemonicResponse['mnemonic']>,
) {
  const grpcClient = useGRPCClient()
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

export function useAccountRegistration(
  opts?: UseMutationOptions<void, unknown, string[]>,
) {
  const grpcClient = useGRPCClient()
  return useMutation({
    mutationFn: async (words: string[]) => {
      await grpcClient.daemon.registerKey({mnemonic: words})
    },
    ...opts,
  })
}

export function useMyAccountIds() {
  const client = useGRPCClient()
  return useQuery({
    queryKey: [queryKeys.LOCAL_ACCOUNT_ID_LIST],
    queryFn: async () => {
      try {
        const q = await client.daemon.listKeys({})
        return q?.keys.map((k) => k.publicKey)
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
  return useEntities(data?.map((k) => hmId('d', k)))
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
  const grpcClient = useGRPCClient()
  return useMutation({
    mutationFn: async ({name = 'main', mnemonic, passphrase}) => {
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
    ...opts,
  })
}

export function useDeleteKey(
  opts?: UseMutationOptions<any, unknown, {accountId: string}>,
) {
  const grpcClient = useGRPCClient()
  const deleteWords = trpc.secureStorage.delete.useMutation()
  return useMutation({
    mutationFn: async ({accountId}) => {
      const keys = await grpcClient.daemon.listKeys({})
      const keyToDelete = keys.keys.find((key) => accountId == key.publicKey)
      if (!keyToDelete) throw new Error('Key not found')
      const deletedKey = await grpcClient.daemon.deleteKey({
        name: keyToDelete.name,
      })

      console.log(`== ~ mutationFn: ~ deletedKey:`, deletedKey)
      const words = await deleteWords.mutateAsync(keyToDelete.name)

      console.log(`== ~ mutationFn: ~ words:`, words)
      return deletedKey
    },
    onSuccess: () => {
      invalidateQueries([queryKeys.LOCAL_ACCOUNT_ID_LIST])
    },
    ...opts,
  })
}

export function useSavedMnemonics(name: NamedKey['name'] | undefined) {
  return trpc.secureStorage.read.useQuery(name, {
    enabled: !!name,
  })
}
