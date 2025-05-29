import {grpcClient} from '@/grpc-client'
import {useAccount_deprecated, useAccountList} from '@/models/accounts'
import {client} from '@/trpc'
import {toPlainMessage} from '@bufbuild/protobuf'
import {decode as cborDecode} from '@ipld/dag-cbor'
import {
  HMContact,
  HMPeerConnectionRequestSchema,
  HMTimestamp,
  UnpackedHypermediaId,
} from '@shm/shared'
import {useAccount} from '@shm/shared/models/entity'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {fullInvalidate, queryKeys} from '@shm/shared/models/query-keys'
import {
  useMutation,
  UseMutationOptions,
  useQueries,
  useQuery,
} from '@tanstack/react-query'
import {base58btc} from 'multiformats/bases/base58'
import {useDaemonInfo, useMyAccountIds} from './daemon'
import {useConnectedPeers} from './networking'

function queryContactListOfSubject(accountUid: string) {
  return {
    queryKey: [queryKeys.CONTACTS_SUBJECT, accountUid],
    queryFn: async () => {
      const contacts = await grpcClient.documents.listContacts({
        filter: {
          case: 'subject',
          value: accountUid,
        },
      })
      return contacts.contacts.map((c) => toPlainMessage(c))
    },
  }
}

export function useContactListOfSubject(accountUid: string) {
  const contacts = useQuery(queryContactListOfSubject(accountUid))
  return contacts
}

function queryContactListOfAccount(accountUid: string) {
  return {
    queryKey: [queryKeys.CONTACTS_ACCOUNT, accountUid],
    queryFn: async () => {
      const contacts = await grpcClient.documents.listContacts({
        filter: {
          case: 'account',
          value: accountUid,
        },
      })
      return contacts.contacts.map((c) => toPlainMessage(c))
    },
  }
}

export function useContactListOfAccount(accountUid: string) {
  const contacts = useQuery(queryContactListOfAccount(accountUid))
  return contacts
}

export function useContactListsOfAccount(accountUids: string[]) {
  const contacts = useQueries({
    queries: accountUids.map((aUid) => queryContactListOfAccount(aUid)),
  })
  return contacts
}

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

export function useContact(id: UnpackedHypermediaId) {
  const account = useAccount(id.uid)
  const subjectContacts = useContactListOfSubject(id.uid)
  const accountContacts = useContactListOfAccount(id.uid)
  return {
    ...account,
    data: account.data?.metadata
      ? ({
          metadata: account.data.metadata,
          contacts: accountContacts.data,
          subjectContacts: subjectContacts.data,
        } satisfies HMContact)
      : undefined,
  }
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

export function useSaveContact() {
  return useMutation({
    mutationFn: async (contact: {
      accountUid: string
      name: string
      subjectUid: string
    }) => {
      await grpcClient.documents.createContact({
        signingKeyName: contact.accountUid,
        account: contact.accountUid,
        name: contact.name,
        subject: contact.subjectUid,
      })
    },
    onSuccess: (_, contact) => {
      invalidateQueries([queryKeys.CONTACTS_SUBJECT, contact.subjectUid])
      invalidateQueries([queryKeys.CONTACTS_ACCOUNT, contact.accountUid])
    },
  })
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

export function useAccountWithDevices(accountId: string) {
  const account = useAccount_deprecated(accountId)
  const peers = useConnectedPeers()
  return {
    ...account.data,
    profile: account.data?.profile,

    devices: Object.values(account?.data?.devices || {}).map(
      // TODO: FIX TYPES
      (device: any) => {
        const deviceId = device.deviceId
        return {
          deviceId,
          isConnected: !!peers.data?.find((peer) => peer.id === deviceId),
        }
      },
    ),
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
        encodedPayload = connectionStringMatch[1]
      }
      // the peer string may be hm://connect/<encoded_payload>
      const connectionString2Match = peer.match(/connect\/([\w\-\+]+)/)
      if (connectionString2Match && !encodedPayload) {
        encodedPayload = connectionString2Match[1]
      }
      let addrs: string[] | null = null
      if (encodedPayload) {
        const decodedBinary = base58btc.decode(encodedPayload)
        const decoded = cborDecode(decodedBinary)
        const connectPayload = HMPeerConnectionRequestSchema.parse(decoded)
        addrs = connectPayload.a.map(
          (shortAddr: string) => `${shortAddr}/p2p/${connectPayload.d}`,
        )
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
        await grpcClient.daemon.forceSync({})
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
