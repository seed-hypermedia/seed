import {grpcClient} from '@/grpc-client'
import {useAccountList} from '@/models/accounts'
import {client} from '@/trpc'
import {decode as cborDecode} from '@ipld/dag-cbor'
import {getContactMetadata, HMPeerConnectionRequestSchema, HMTimestamp} from '@shm/shared'
import {BIG_INT} from '@shm/shared/constants'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {fullInvalidate, queryKeys} from '@shm/shared/models/query-keys'
import {useMutation, UseMutationOptions} from '@tanstack/react-query'
import {base58btc} from 'multiformats/bases/base58'
import {useDaemonInfo, useMyAccountIds} from './daemon'
import {useConnectedPeers} from './networking'

import {useContactListsOfAccount, useSelectedAccountContacts} from '@shm/shared/models/contacts'

export function useMyContacts() {
  const accts = useMyAccountIds()
  const lists = useContactListsOfAccount(accts.data ?? [])
  const output: {
    account: string
    name: string
    subject: string
    updateTime?: HMTimestamp | undefined
    createTime?: HMTimestamp | undefined
  }[] = []
  lists.forEach((list) => {
    list.data?.forEach((contact) => {
      output.push(contact)
    })
  })
  return output
}

export function useAllAccountsWithContacts() {
  const allAccounts = useAccountList()
  const myContacts = useMyContacts()
  const data = allAccounts.data?.accounts.map((account) => {
    return {
      ...account,
      metadata: account.metadata,
      myContacts: myContacts?.filter((c) => c.subject === account.id) || [],
    }
  })
  return {
    ...allAccounts,
    data,
  }
}

export function useConnectionSummary() {
  const {data: deviceInfo} = useDaemonInfo()
  const peerInfo = useConnectedPeers({
    refetchInterval: 15_000,
  })
  const connectedPeers = (peerInfo.data || []).filter((peer) => {
    if (peer.protocol && peer.protocol !== deviceInfo?.protocolId) {
      return false
    }
    return true
  })
  return {
    online: connectedPeers.length > 0,
    connectedCount: connectedPeers.length,
  }
}

export function useConnectPeer(
  opts: UseMutationOptions<undefined, void, string | undefined> & {
    syncImmediately?: boolean
    aggressiveInvalidation?: boolean
  } = {},
) {
  return useMutation<undefined, void, string | undefined>({
    mutationFn: async (peer: string | undefined) => {
      if (!peer) return undefined
      let encodedPayload: string | null = null
      // the peer string may be: https://any-web/hm/connect#<encoded_paylod>
      const connectionStringMatch = peer.match(/connect#([\w\-\+]+)/)
      if (connectionStringMatch) {
        // @ts-ignore
        encodedPayload = connectionStringMatch[1]
      }
      // the peer string may be hm://connect/<encoded_payload>
      const connectionString2Match = peer.match(/connect\/([\w\-\+]+)/)
      if (connectionString2Match && !encodedPayload) {
        // @ts-ignore
        encodedPayload = connectionString2Match[1]
      }
      let addrs: string[] | null = null
      if (encodedPayload) {
        const decodedBinary = base58btc.decode(encodedPayload)
        const decoded = cborDecode(decodedBinary)
        const connectPayload = HMPeerConnectionRequestSchema.parse(decoded)
        addrs = connectPayload.a.map((shortAddr: string) => `${shortAddr}/p2p/${connectPayload.d}`)
      }
      if (!addrs && peer.match(/^(https?:\/\/)/)) {
        // in this case, the "peer" input is not https://site/hm/connect#x url, but it is a web url. So lets try to connect to this site via its well known peer id.
        const peerUrl = new URL(peer)
        let baseUrl = `${peerUrl.protocol}//${peerUrl.hostname}`
        if (peerUrl.port) baseUrl += `:${peerUrl.port}`
        const siteConfigData = await client.sites.getConfig.mutate(baseUrl)
        if (siteConfigData?.addrs) {
          addrs = siteConfigData.addrs
        } else {
          throw new Error('Failed to connet to web url: ' + peer)
        }
      }
      if (!addrs) {
        addrs = peer.trim().split(/(?:,|\s|\n)+/) // Split by comma, space, or newline
      }
      if (!addrs) throw new Error('Invalid peer address(es) provided.')
      console.log('WILL CONNECT TO', addrs)
      await grpcClient.networking.connect({addrs})
      if (opts.syncImmediately) {
        // this fn has been deleted from the daemon API
        // await grpcClient.daemon.forceSync({})
      }
      return undefined
    },
    ...opts,
    onSuccess: (data, ...rest) => {
      if (opts.aggressiveInvalidation) {
        // invalidate frequently for 4 minutes while initial sync completes
        const invalidationInterval = setInterval(() => {
          fullInvalidate(invalidateQueries)
        }, 6_000)
        setTimeout(() => {
          clearInterval(invalidationInterval)
        }, 4 * 60_000)
      }
      invalidateQueries([queryKeys.PEERS])
      opts?.onSuccess?.(data, ...rest)
    },
  })
}

export function useContactList() {
  const accounts = useAccountList({
    queryOptions: {
      pageSize: BIG_INT,
    },
  })
  const contacts = useSelectedAccountContacts()
  if (!accounts.data) return accounts
  return {
    ...accounts,
    data: {
      accounts: accounts.data.accounts.map((account) => {
        return {
          ...account,
          metadata: getContactMetadata(account.id, account.metadata, contacts.data),
        }
      }),
      accountsMetadata: Object.fromEntries(
        Object.entries(accounts.data.accountsMetadata)
          .map(([id, account]) => {
            if (!account.metadata) return null
            return [
              id,
              {
                ...account,
                metadata: getContactMetadata(id, account.metadata, contacts.data),
              },
            ]
          })
          .filter((a) => !!a) || [],
      ),
    },
  }
}
