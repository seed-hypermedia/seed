import {hmId} from '../utils/entity-id-url'
import {useDeleteContact, useSaveContact, useSelectedAccountContacts} from './contacts'
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
    // Check if there's an existing contact for this subject (might have profile subscription only)
    const existingContact = selectedAccountContacts.data?.find((c) => c.subject === siteUid)
    if (existingContact) {
      // Check if existing contact has profile subscription (explicit or implicit legacy)
      const hadProfileSubscription = hasProfileSubscription(existingContact)
      // Update existing contact to add site subscription, preserving profile if it existed
      await saveContact.mutateAsync({
        accountUid: selectedAccountId,
        name: existingContact.name,
        subjectUid: siteUid,
        subscribe: {
          ...existingContact.subscribe,
          site: true,
          // Explicitly preserve profile subscription (handles legacy contacts with implicit profile)
          ...(hadProfileSubscription && {profile: true}),
        },
        editId: existingContact.id,
      })
    } else {
      // Create new contact with site subscription
      await saveContact.mutateAsync({
        accountUid: selectedAccountId,
        name: '',
        subjectUid: siteUid,
        subscribe: {site: true},
      })
    }
  }

  return {
    isJoined,
    isPending: saveContact.isPending,
    siteName,
    isOwnAccount,
    joinSite,
  }
}

/** Hook for leaving a site (removing subscribe.site from a contact). */
export function useLeaveSite({siteUid}: {siteUid: string}) {
  const selectedAccountId = useSelectedAccountId()
  const selectedAccountContacts = useSelectedAccountContacts()
  const saveContact = useSaveContact()
  const deleteContact = useDeleteContact()

  // Find contact with site subscription
  const siteContact = selectedAccountContacts.data?.find((c) => c.subject === siteUid && c.subscribe?.site)

  const isOwnAccount = selectedAccountId === siteUid
  const isSiteMember = isOwnAccount || !!siteContact

  const leaveSite = async () => {
    if (!selectedAccountId) {
      throw new Error('No account selected')
    }
    if (!siteContact) {
      return // Not a member, nothing to do
    }

    // Check if contact has profile subscription
    const hasProfileSubscription =
      siteContact.subscribe?.profile ||
      (!siteContact.subscribe?.site && !siteContact.subscribe?.profile) // Legacy: implicit profile

    if (hasProfileSubscription) {
      // Update contact to remove site subscription, keep profile
      await saveContact.mutateAsync({
        accountUid: selectedAccountId,
        name: siteContact.name,
        subjectUid: siteUid,
        subscribe: {profile: true},
        editId: siteContact.id,
      })
    } else {
      // No profile subscription, delete the contact
      await deleteContact.mutateAsync({
        id: siteContact.id,
        account: siteContact.account,
        subject: siteContact.subject,
        signer: siteContact.signer,
      })
    }
  }

  return {
    isSiteMember,
    isPending: saveContact.isPending || deleteContact.isPending,
    isOwnAccount,
    leaveSite,
  }
}

/**
 * Check if a contact has profile subscription (explicit or implicit).
 * For backwards compatibility, contacts without any subscribe field are treated as having profile=true.
 */
export function hasProfileSubscription(contact: {subscribe?: {site?: boolean; profile?: boolean}}): boolean {
  // Explicit profile subscription
  if (contact.subscribe?.profile) return true
  // Legacy contact: no subscribe field means implicit profile subscription
  if (!contact.subscribe || (!contact.subscribe.site && !contact.subscribe.profile)) return true
  return false
}

/** Hook for following a profile (saving it as a contact with subscribe.profile=true). */
export function useFollowProfile({profileUid}: {profileUid: string}) {
  const selectedAccountId = useSelectedAccountId()
  const selectedAccountContacts = useSelectedAccountContacts()
  const saveContact = useSaveContact()
  const deleteContact = useDeleteContact()

  // Find contact with profile subscription (explicit or implicit for legacy contacts)
  const profileContact = selectedAccountContacts.data?.find(
    (c) => c.subject === profileUid && hasProfileSubscription(c),
  )

  const isOwnAccount = selectedAccountId === profileUid
  const isFollowing = isOwnAccount || !!profileContact

  const followProfile = async () => {
    if (!selectedAccountId) {
      throw new Error('No account selected')
    }
    // Check if there's an existing contact for this subject (might have site subscription only)
    const existingContact = selectedAccountContacts.data?.find((c) => c.subject === profileUid)
    if (existingContact) {
      // Update existing contact to add profile subscription
      await saveContact.mutateAsync({
        accountUid: selectedAccountId,
        name: existingContact.name,
        subjectUid: profileUid,
        subscribe: {...existingContact.subscribe, profile: true},
        editId: existingContact.id,
      })
    } else {
      // Create new contact with profile subscription
      await saveContact.mutateAsync({
        accountUid: selectedAccountId,
        name: '',
        subjectUid: profileUid,
        subscribe: {profile: true},
      })
    }
  }

  const unfollowProfile = async () => {
    if (!selectedAccountId) {
      throw new Error('No account selected')
    }
    // Find ALL contacts with profile subscription (explicit or implicit)
    const contactsWithProfile =
      selectedAccountContacts.data?.filter((c) => c.subject === profileUid && hasProfileSubscription(c)) ?? []

    // Process each contact
    await Promise.all(
      contactsWithProfile.map(async (contact) => {
        // Check if contact has site subscription (the only other subscription type)
        const hasSiteSubscription = contact.subscribe?.site

        if (hasSiteSubscription) {
          // Update contact to remove profile subscription, keep site
          await saveContact.mutateAsync({
            accountUid: selectedAccountId,
            name: contact.name,
            subjectUid: profileUid,
            subscribe: {site: true},
            editId: contact.id,
          })
        } else {
          // No other subscriptions (or legacy contact), delete the contact
          await deleteContact.mutateAsync({
            id: contact.id,
            account: contact.account,
            subject: contact.subject,
            signer: contact.signer,
          })
        }
      }),
    )
  }

  return {
    isFollowing,
    isPending: saveContact.isPending || deleteContact.isPending,
    isOwnAccount,
    followProfile,
    unfollowProfile,
  }
}
