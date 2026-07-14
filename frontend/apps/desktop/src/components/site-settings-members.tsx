import {useSelectedAccountId} from '@/selected-account'
import {client} from '@/trpc'
import {useNavigate} from '@/utils/useNavigate'
import type {HMMetadataPayload, HMSiteMember, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared'
import {useAddCapabilities, useIsSiteOwner, useSelectedAccountCapability} from '@shm/shared/models/capabilities'
import {useResource, useSiteMembers} from '@shm/shared/models/entity'
import {queryKeys} from '@shm/shared/models/query-keys'
import type {SiteSettingsTab} from '@shm/shared/routes'
import {Button} from '@shm/ui/button'
import {HMIcon} from '@shm/ui/hm-icon'
import {SiteEmailSubscribersList} from '@shm/ui/site-email-subscribers'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {cn} from '@shm/ui/utils'
import {useQuery} from '@tanstack/react-query'
import {type ReactNode, useMemo, useState} from 'react'

type MemberSubTab = 'members' | 'writers' | 'email-subscribers'

const SUB_TABS: {key: MemberSubTab; label: string}[] = [
  {key: 'members', label: 'Members'},
  {key: 'writers', label: 'Writers'},
  {key: 'email-subscribers', label: 'Email Subscribers'},
]

function roleLabel(role: string): string {
  if (role === 'writer') return 'Writer'
  if (role === 'owner') return 'Owner'
  if (role === 'agent') return 'Device'
  return 'Member'
}

export function MembersSettings({siteId, activeTab}: {siteId: UnpackedHypermediaId; activeTab?: SiteSettingsTab}) {
  const navigate = useNavigate('replace')
  const resource = useResource(siteId)
  const document = resource.data?.type === 'document' ? resource.data.document : undefined
  const {isSiteOwner, isLoading: isOwnerLoading} = useIsSiteOwner(siteId.uid)
  const {accounts, grantedMembers, members, isInitialLoading} = useSiteMembers(siteId)
  const signAs = useSelectedAccountId()
  const metadataSiteUrl = document?.metadata?.siteUrl

  // Only query when the siteUrl exists
  const subscribers = useQuery({
    queryKey: [queryKeys.SITE_EMAIL_SUBSCRIBERS, metadataSiteUrl ?? null, siteId.uid, signAs],
    queryFn: () =>
      client.sites.getEmailSubscribers.query({siteUrl: metadataSiteUrl, accountUid: siteId.uid, signAs: signAs!}),
    enabled: !!signAs && isSiteOwner && !!metadataSiteUrl,
    retry: false,
  })

  const {membersList, writersList} = useMemo(() => {
    const owner: HMSiteMember = {account: hmId(siteId.uid), role: 'owner'}
    const seen = new Set<string>()
    const deduped = [owner, ...grantedMembers, ...members].filter((m) => {
      if (seen.has(m.account.uid)) return false
      seen.add(m.account.uid)
      return true
    })
    return {
      membersList: deduped.filter((m) => m.role === 'member'),
      writersList: deduped.filter((m) => m.role === 'writer' || m.role === 'owner'),
    }
  }, [grantedMembers, members, siteId.uid])

  const subTab: MemberSubTab = activeTab === 'writers' || activeTab === 'email-subscribers' ? activeTab : 'members'

  if (resource.isInitialLoading || isOwnerLoading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    )
  }
  if (!document) {
    return <SizableText color="muted">This account doesn't have a site yet.</SizableText>
  }
  if (!isSiteOwner) {
    return (
      <>
        <SizableText size="2xl" weight="bold">
          People with access
        </SizableText>
        <SizableText color="muted">Only the site owner can view members.</SizableText>
      </>
    )
  }

  const counts: Record<MemberSubTab, number | undefined> = {
    members: membersList.length,
    writers: writersList.length,
    'email-subscribers': subscribers.data?.subscribers?.length,
  }

  return (
    <>
      <SizableText size="2xl" weight="bold">
        People with access
      </SizableText>

      {/* Sub-tab bar with counts */}
      <div className="border-border flex gap-1 border-b">
        {SUB_TABS.map((t) => {
          const count = counts[t.key]
          const active = subTab === t.key
          return (
            <button
              key={t.key}
              onClick={() => navigate({key: 'site-settings', id: siteId, tab: t.key})}
              className={cn(
                '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors',
                active
                  ? 'border-brand text-brand-2 font-medium'
                  : 'text-muted-foreground hover:text-foreground border-transparent',
              )}
            >
              {t.label}
              {count !== undefined ? (
                <span className="bg-muted text-muted-foreground rounded-full px-1.5 text-xs">{count}</span>
              ) : null}
            </button>
          )
        })}
      </div>

      {subTab === 'members' && (
        <MembersList siteId={siteId} people={membersList} accounts={accounts} isLoading={isInitialLoading} />
      )}
      {subTab === 'writers' && <WritersPane people={writersList} accounts={accounts} isLoading={isInitialLoading} />}
      {subTab === 'email-subscribers' && (
        <div className="py-2">
          {metadataSiteUrl ? (
            <SiteEmailSubscribersList
              subscribers={subscribers.data?.subscribers}
              isLoading={subscribers.isLoading}
              errorMessage={subscribers.error instanceof Error ? subscribers.error.message : null}
            />
          ) : (
            <SizableText color="muted" className="py-4">
              This site doesn't have a notification service configured, so it can't collect email subscribers yet.
            </SizableText>
          )}
        </div>
      )}
    </>
  )
}

function MembersList({
  siteId,
  people,
  accounts,
  isLoading,
}: {
  siteId: UnpackedHypermediaId
  people: HMSiteMember[]
  accounts: Record<string, HMMetadataPayload>
  isLoading: boolean
}) {
  const myCapability = useSelectedAccountCapability(siteId, 'owner')
  const addCapabilities = useAddCapabilities(siteId)
  const [promotingUid, setPromotingUid] = useState<string | null>(null)

  const promote = (accountUid: string) => {
    if (!myCapability) return
    setPromotingUid(accountUid)
    addCapabilities.mutate(
      {myCapability, collaboratorAccountIds: [accountUid], role: 'WRITER'},
      {
        onSuccess: () => toast.success('Writer access granted'),
        onError: () => toast.error('Failed to grant writer access'),
        onSettled: () => setPromotingUid(null),
      },
    )
  }

  if (isLoading) return <ListSpinner />
  if (!people.length) return <EmptyMessage>No members yet.</EmptyMessage>

  return (
    <div className="flex flex-col gap-1 py-2">
      {people.map((member) => (
        <MemberRow
          key={member.account.uid}
          member={member}
          account={accounts[member.account.uid]}
          action={
            myCapability ? (
              <Button
                size="xs"
                variant="outline"
                loading={promotingUid === member.account.uid}
                onClick={() => promote(member.account.uid)}
              >
                Add as writer
              </Button>
            ) : null
          }
        />
      ))}
    </div>
  )
}

function WritersPane({
  people,
  accounts,
  isLoading,
}: {
  people: HMSiteMember[]
  accounts: Record<string, HMMetadataPayload>
  isLoading: boolean
}) {
  if (isLoading) return <ListSpinner />
  if (!people.length) return <EmptyMessage>No writers yet.</EmptyMessage>
  return (
    <div className="flex flex-col gap-1 py-2">
      {people.map((member) => (
        <MemberRow key={member.account.uid} member={member} account={accounts[member.account.uid]} />
      ))}
    </div>
  )
}

function MemberRow({member, account, action}: {member: HMSiteMember; account?: HMMetadataPayload; action?: ReactNode}) {
  const metadata = account?.metadata
  const name = metadata?.name || `${member.account.uid.slice(0, 10)}…`
  return (
    <div className="group hover:bg-muted flex items-center gap-3 rounded-md p-3 transition-colors">
      <HMIcon id={member.account} name={metadata?.name} icon={metadata?.icon} size={32} />
      <SizableText size="sm" className={cn('flex-1 truncate', metadata?.name ? '' : 'text-muted-foreground')}>
        {name}
      </SizableText>
      {action && member.role === 'member' ? (
        <div className="opacity-0 transition-opacity group-hover:opacity-100">{action}</div>
      ) : null}
      <SizableText size="xs" color="muted" className="shrink-0">
        {roleLabel(member.role)}
      </SizableText>
    </div>
  )
}

function ListSpinner() {
  return (
    <div className="flex justify-center py-8">
      <Spinner />
    </div>
  )
}

function EmptyMessage({children}: {children: ReactNode}) {
  return (
    <SizableText color="muted" className="py-4">
      {children}
    </SizableText>
  )
}
