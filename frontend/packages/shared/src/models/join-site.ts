import {hmId} from '../utils/entity-id-url'
import {useSaveContact, useSelectedAccountContacts} from './contacts'
import {useResource, useSelectedAccountId} from './entity'

export function useJoinSite({siteUid}: {siteUid: string}) {
  const selectedAccountId = useSelectedAccountId()
  const selectedAccountContacts = useSelectedAccountContacts()
  const saveContact = useSaveContact()

  const siteResource = useResource(hmId(siteUid))
  const siteName = siteResource.data?.type === 'document' ? siteResource.data.document?.metadata?.name : undefined

  const isSiteMember = selectedAccountContacts.data?.some((c) => c.subject === siteUid && c.subscribe?.site) ?? false

  const isOwnAccount = selectedAccountId === siteUid

  const isJoined = isOwnAccount || isSiteMember

  const joinSite = async () => {
    if (!selectedAccountId) {
      throw new Error('No account selected')
    }
    console.log('Joining Site', {selectedAccountId, siteUid})
    await saveContact.mutateAsync({
      accountUid: selectedAccountId,
      name: '',
      subjectUid: siteUid,
      subscribe: {site: true},
    })
  }

  return {
    isJoined,
    isPending: saveContact.isPending,
    siteName,
    isOwnAccount,
    joinSite,
  }
}
