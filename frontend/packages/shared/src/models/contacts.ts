import {
  createContact as createContactBlob,
  deleteContact as deleteContactBlob,
  updateContact as updateContactBlob,
} from '@seed-hypermedia/client'
import {ContactSubscribe} from '@seed-hypermedia/client/contact'
import type {HMAccountsMetadata, HMContact, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useMutation, useQueries, useQuery} from '@tanstack/react-query'
import {getContactMetadata} from '../content'
import {useUniversalClient} from '../routing'
import {hmId} from '../utils/entity-id-url'
import {useAccount, useAccounts, useAccountsMetadata, useResources, useSelectedAccountId} from './entity'
import {queryContactsOfAccount, queryContactsOfSubject} from './queries'
import {invalidateQueries} from './query-client'
import {queryKeys} from './query-keys'

export function useSaveContact() {
  const client = useUniversalClient()
  return useMutation({
    mutationFn: async (contact: {
      accountUid: string
      name: string
      subjectUid: string
      subscribe?: ContactSubscribe
      editId?: string
    }) => {
      if (!client.getSigner) throw new Error('Signing not available on this platform')
      const signer = client.getSigner(contact.accountUid)
      if (contact.editId) {
        await client.publish(
          await updateContactBlob(
            {
              contactId: contact.editId,
              subjectUid: contact.subjectUid,
              name: contact.name,
              subscribe: contact.subscribe,
            },
            signer,
          ),
        )
      } else {
        await client.publish(
          await createContactBlob(
            {
              subjectUid: contact.subjectUid,
              name: contact.name,
              accountUid: contact.accountUid,
              subscribe: contact.subscribe,
            },
            signer,
          ),
        )
      }
    },
    onSuccess: (_, contact) => {
      invalidateQueries([queryKeys.CONTACTS_SUBJECT, contact.subjectUid])
      invalidateQueries([queryKeys.CONTACTS_ACCOUNT, contact.accountUid])
    },
  })
}

export function useDeleteContact() {
  const client = useUniversalClient()
  return useMutation({
    mutationFn: async (contact: {id: string; account: string; subject: string; signer: string}) => {
      if (!client.getSigner) throw new Error('Signing not available on this platform')
      // Try to get original signer first, fall back to any key with agent capability for the account.
      // This handles web linked accounts where the original signer key may not be available.
      let signer = client.getSigner(contact.signer)
      if (!signer) {
        signer = client.getSigner(contact.account)
      }
      if (!signer) {
        throw new Error('No signing key available for this contact')
      }
      await client.publish(await deleteContactBlob({contactId: contact.id}, signer))
    },
    onSuccess: (_, contact) => {
      invalidateQueries([queryKeys.CONTACTS_SUBJECT, contact.subject])
      invalidateQueries([queryKeys.CONTACTS_ACCOUNT, contact.account])
    },
  })
}

export function useContactListOfSubject(accountUid: string | undefined) {
  const client = useUniversalClient()
  return useQuery(queryContactsOfSubject(client, accountUid))
}

export function useContactListOfAccount(accountUid: string | null | undefined) {
  const client = useUniversalClient()
  return useQuery(queryContactsOfAccount(client, accountUid))
}

export function useContactListsOfAccount(accountUids: string[]) {
  const client = useUniversalClient()
  return useQueries({
    queries: accountUids.map((uid) => queryContactsOfAccount(client, uid)),
  })
}

export function useSelectedAccountContacts() {
  const selectedAccount = useSelectedAccountId()
  return useContactListOfAccount(selectedAccount)
}

export function useContact(id: UnpackedHypermediaId | undefined) {
  const account = useAccount(id?.uid)
  const subjectContacts = useContactListOfSubject(id?.uid)
  const accountContacts = useContactListOfAccount(id?.uid)
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

export function useContacts(accountUids: string[]) {
  const accounts = useAccounts(accountUids)
  // we're currently relying on the account discovery here. we would ideally build it into useAccounts
  useResources(
    accountUids.map((uid) => hmId(uid)),
    {subscribed: true},
  )
  const contacts = useSelectedAccountContacts()

  return accounts.map((account) => {
    return {
      ...account,
      data: account.data
        ? {
            id: account.data.id,
            metadata: getContactMetadata(account.data.id.uid, account.data.metadata, contacts.data),
          }
        : undefined,
    }
  })
}

export function useContactsMetadata(ids: string[]): HMAccountsMetadata {
  const accountsMetadata = useAccountsMetadata(ids)
  const contacts = useSelectedAccountContacts()
  return Object.fromEntries(
    Object.entries(accountsMetadata.data).map(([uid, account]) => {
      return [
        uid,
        {
          id: account.id,
          metadata: getContactMetadata(account.id.uid, account.metadata, contacts.data),
        },
      ]
    }),
  )
}
