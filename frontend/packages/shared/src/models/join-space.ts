import {hmId} from '../utils/entity-id-url'
import {useDeleteContact, useSaveContact, useSelectedAccountContacts} from './contacts'
import {useResource, useSelectedAccountId} from './entity'

export function useJoinSpace({spaceUid}: {spaceUid: string}) {
  const selectedAccountId = useSelectedAccountId()
  const selectedAccountContacts = useSelectedAccountContacts()
  const saveContact = useSaveContact()

  const spaceResource = useResource(hmId(spaceUid))
  const spaceName = spaceResource.data?.type === 'document' ? spaceResource.data.document?.metadata?.name : undefined

  const isSpaceMember = selectedAccountContacts.data?.some((c) => c.subject === spaceUid && c.subscribe?.site) ?? false

  const isOwnAccount = selectedAccountId === spaceUid

  const isJoined = isOwnAccount || isSpaceMember

  const joinSpace = async () => {
    if (!selectedAccountId) {
      throw new Error('No account selected')
    }
    console.log('Joining Space', {selectedAccountId, spaceUid})
    // Check if there's an existing contact for this subject (might have profile subscription only)
    const existingContact = selectedAccountContacts.data?.find((c) => c.subject === spaceUid)
    if (existingContact) {
      // Check if existing contact has profile subscription (explicit or implicit legacy)
      const hadProfileSubscription = hasProfileSubscription(existingContact)
      // Update existing contact to add space subscription, preserving profile if it existed
      await saveContact.mutateAsync({
        accountUid: selectedAccountId,
        name: existingContact.name,
        subjectUid: spaceUid,
        subscribe: {
          ...existingContact.subscribe,
          site: true,
          // Explicitly preserve profile subscription (handles legacy contacts with implicit profile)
          ...(hadProfileSubscription && {profile: true}),
        },
        editId: existingContact.id,
      })
    } else {
      // Create new contact with space subscription
      await saveContact.mutateAsync({
        accountUid: selectedAccountId,
        name: '',
        subjectUid: spaceUid,
        subscribe: {site: true},
      })
    }
  }

  return {
    isJoined,
    isPending: saveContact.isPending,
    spaceName,
    isOwnAccount,
    joinSpace,
  }
}

/** Hook for leaving a space (removing subscribe.site from a contact). */
export function useLeaveSpace({spaceUid}: {spaceUid: string}) {
  const selectedAccountId = useSelectedAccountId()
  const selectedAccountContacts = useSelectedAccountContacts()
  const saveContact = useSaveContact()
  const deleteContact = useDeleteContact()

  // Find contact with space subscription
  const spaceContact = selectedAccountContacts.data?.find((c) => c.subject === spaceUid && c.subscribe?.site)

  const isOwnAccount = selectedAccountId === spaceUid
  const isSpaceMember = isOwnAccount || !!spaceContact

  const leaveSpace = async () => {
    if (!selectedAccountId) {
      throw new Error('No account selected')
    }
    if (!spaceContact) {
      return // Not a member, nothing to do
    }

    // Check if contact has profile subscription
    const hasProfileSubscription =
      spaceContact.subscribe?.profile || (!spaceContact.subscribe?.site && !spaceContact.subscribe?.profile) // Legacy: implicit profile

    if (hasProfileSubscription) {
      // Update contact to remove space subscription, keep profile
      await saveContact.mutateAsync({
        accountUid: selectedAccountId,
        name: spaceContact.name,
        subjectUid: spaceUid,
        subscribe: {profile: true},
        editId: spaceContact.id,
      })
    } else {
      // No profile subscription, delete the contact
      await deleteContact.mutateAsync({
        id: spaceContact.id,
        account: spaceContact.account,
        subject: spaceContact.subject,
        signer: spaceContact.signer,
      })
    }
  }

  return {
    isSpaceMember,
    isPending: saveContact.isPending || deleteContact.isPending,
    isOwnAccount,
    leaveSpace,
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
    // Check if there's an existing contact for this subject (might have space subscription only)
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
        // Check if contact has space subscription (the only other subscription type)
        const hasSpaceSubscription = contact.subscribe?.site

        if (hasSpaceSubscription) {
          // Update contact to remove profile subscription, keep space
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
