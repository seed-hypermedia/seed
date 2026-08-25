import {useSetSubscription} from '@/models/subscription'
import {useSelectedAccountId} from '@/selected-account'
import {createContact, updateContact} from '@seed-hypermedia/client'
import {queryKeys, useUniversalClient} from '@shm/shared'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {toast} from '@shm/ui/toast'
import {ReactNode, useCallback} from 'react'
import {useDesktopAuthDialog} from './desktop-auth-dialog'

/** Optional overrides for the identity dialog. */
export type RequireAccountOptions = {
  title?: string
  introDescription?: string
  spaceName?: string
}

/** Dialog content and account gate callback returned by desktop intent hooks. */
export type DesktopIntentResult = {
  content: ReactNode
  requireAccount: (action: (accountUid: string) => void | Promise<void>, options?: RequireAccountOptions) => void
}

/** Runs a desktop action immediately when an account exists, or after identity setup completes. */
export function useDesktopAccountIntent(): DesktopIntentResult {
  const selectedAccountId = useSelectedAccountId()
  const authDialog = useDesktopAuthDialog()

  const requireAccount = useCallback(
    (action: (accountUid: string) => void | Promise<void>, options?: RequireAccountOptions) => {
      if (selectedAccountId) {
        void action(selectedAccountId)
        return
      }
      authDialog.open({
        onReady: action,
        title: options?.title,
        introDescription: options?.introDescription,
        spaceName: options?.spaceName,
      })
    },
    [authDialog, selectedAccountId],
  )

  return {content: authDialog.content, requireAccount}
}

/** Adds a space/profile subscription contact for the supplied account. */
export function useContactSubscribeIntent() {
  const universalClient = useUniversalClient()

  return useCallback(
    async (input: {accountUid: string; subjectUid: string; subscribe: 'site' | 'profile'}) => {
      if (!universalClient.getSigner) throw new Error('Signing not available')
      const contacts = await universalClient.request('AccountContacts', input.accountUid)
      const existingContact = contacts.find((contact) => contact.subject === input.subjectUid)
      const signer = universalClient.getSigner(input.accountUid)
      const hadLegacyProfile = existingContact && !existingContact.subscribe
      const nextSubscribe = {
        ...(hadLegacyProfile ? {profile: true} : existingContact?.subscribe),
        [input.subscribe]: true,
      }

      if (existingContact) {
        await universalClient.publish(
          await updateContact(
            {
              contactId: existingContact.id,
              subjectUid: input.subjectUid,
              name: existingContact.name,
              subscribe: nextSubscribe,
            },
            signer,
          ),
        )
      } else {
        await universalClient.publish(
          await createContact(
            {
              accountUid: input.accountUid,
              subjectUid: input.subjectUid,
              name: '',
              subscribe: nextSubscribe,
            },
            signer,
          ),
        )
      }

      invalidateQueries([queryKeys.CONTACTS_ACCOUNT, input.accountUid])
      invalidateQueries([queryKeys.CONTACTS_SUBJECT, input.subjectUid])
    },
    [universalClient],
  )
}

/** Joins a space now or after desktop identity setup, then shows the standard success/error toast. */
export function useJoinSpaceIntent(spaceUid: string, spaceName?: string) {
  const {content, requireAccount} = useDesktopAccountIntent()
  const subscribeContact = useContactSubscribeIntent()
  const setSubscription = useSetSubscription()

  const join = useCallback(() => {
    requireAccount(
      async (accountUid) => {
        if (accountUid === spaceUid) return
        try {
          await subscribeContact({accountUid, subjectUid: spaceUid, subscribe: 'site'})
          setSubscription.mutate({id: hmId(spaceUid), subscribed: true, recursive: true})
          toast.success(`Joined ${spaceName || 'space'}`)
        } catch (error) {
          console.error('Failed to join:', error)
          toast.error('Failed to join')
        }
      },
      {
        title: `Join ${spaceName || 'this space'}`,
        introDescription: 'Create your identity to participate, it takes two minutes.',
        spaceName,
      },
    )
  }, [requireAccount, setSubscription, spaceName, spaceUid, subscribeContact])

  return {content, join, isPending: setSubscription.isPending}
}

/** Follows a profile now or after desktop identity setup, then shows the standard success/error toast. */
export function useFollowProfileIntent(profileUid: string) {
  const {content, requireAccount} = useDesktopAccountIntent()
  const subscribeContact = useContactSubscribeIntent()

  const follow = useCallback(() => {
    requireAccount(async (accountUid) => {
      if (accountUid === profileUid) return
      try {
        await subscribeContact({accountUid, subjectUid: profileUid, subscribe: 'profile'})
        toast.success('Followed profile')
      } catch (error) {
        console.error('Failed to follow:', error)
        toast.error('Failed to follow')
      }
    })
  }, [profileUid, requireAccount, subscribeContact])

  return {content, follow}
}
