import {
  HMCapability,
  HMListDocumentCollaboratorsOutput,
  HMMetadataPayload,
  HMSiteMember,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {resolveHypermediaUrl, type DomainResolverFn} from '@seed-hypermedia/client'
import {useRouteLink} from '@shm/shared'
import {useAddCapabilities, useSelectedAccountCapability} from '@shm/shared/models/capabilities'
import {
  useCapabilities,
  useCollaborators,
  useSelectedAccountId,
  useSiteMembers,
} from '@shm/shared/models/entity'
import {useSearch} from '@shm/shared/models/search'
import {abbreviateUid} from '@shm/shared/utils/abbreviate'
import {hmId, hmIdToURL, unpackHmId} from '@shm/shared/utils/entity-id-url'
import {Users} from 'lucide-react'
import {useCallback, useMemo, useState} from 'react'
import {Button} from './button'
import {AccountSearchResult, AccountTagInput, AccountTagInputItem} from './account-tag-input'
import {HMIcon} from './hm-icon'
import {ArrowRight} from './icons'
import {Spinner} from './spinner'
import {SizableText} from './text'
import {toast} from './toast'

/** Account search result used by collaborator search inputs. */
export type SearchResult = AccountSearchResult

/** Returns the number of people rows rendered by the document People tab. */
export function getRenderedCollaboratorsCount(
  collaborators: HMListDocumentCollaboratorsOutput | null | undefined,
  isSiteRoot: boolean,
) {
  if (!collaborators) return 0

  const {accounts} = collaborators
  if (isSiteRoot) {
    return (
      1 +
      collaborators.grantedMembers.filter((member) => accounts[member.account.uid]).length +
      collaborators.members.filter((member) => accounts[member.account.uid]).length
    )
  }

  return (
    1 +
    collaborators.parentCapabilities.filter((capability) => accounts[capability.accountUid]).length +
    collaborators.grantedCapabilities.filter((capability) => accounts[capability.accountUid]).length
  )
}

function AddCollaboratorForm({id, domainResolver}: {id: UnpackedHypermediaId; domainResolver?: DomainResolverFn}) {
  const myCapability = useSelectedAccountCapability(id, 'owner')
  const addCapabilities = useAddCapabilities(id)
  const [selectedCollaborators, setSelectedCollaborators] = useState<SearchResult[]>([])
  const capabilities = useCapabilities(id)

  const excludeUids = useMemo(() => {
    // The owner cannot be added, and accounts that already have a capability are filtered out.
    return [id.uid, ...(capabilities.data?.map((capability) => capability.grantId.uid) ?? [])]
  }, [id.uid, capabilities.data])

  if (!myCapability) return null
  return (
    <div className="flex flex-col gap-2 px-4 pt-4">
      <div className="border-border flex overflow-hidden rounded-md border-1">
        <AccountSearchInput
          label="Members"
          placeholder="Invite members"
          values={selectedCollaborators}
          onValuesChange={setSelectedCollaborators}
          excludeUids={excludeUids}
          domainResolver={domainResolver}
        />
        {selectedCollaborators.length ? (
          <Button
            size="sm"
            className="h-auto rounded-tl-none rounded-bl-none"
            onClick={() => {
              addCapabilities.mutate(
                {
                  myCapability: myCapability,
                  collaboratorAccountIds: selectedCollaborators.map((collab) => collab.id.uid),
                  role: 'WRITER',
                },
                {
                  onSuccess: (_, {collaboratorAccountIds: count}) => {
                    toast.success(`Capabilit${count?.length > 1 ? 'ies' : 'y'} added`)
                  },
                },
              )
              setSelectedCollaborators([])
            }}
            variant="default"
          >
            <ArrowRight className="size-4" />
          </Button>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Reusable multi-select account search. Renders selected accounts as pills (resolving raw account
 * IDs to account names/icons) and accepts free-text search, pasted hm:// IDs, and full URLs.
 */
export function AccountSearchInput({
  label,
  placeholder,
  values,
  onValuesChange,
  excludeUids,
  domainResolver,
}: {
  label: string
  placeholder?: string
  values: SearchResult[]
  onValuesChange: (values: SearchResult[]) => void
  /** Account UIDs to omit from search matches (e.g. the owner or already-added accounts). */
  excludeUids?: string[]
  domainResolver?: DomainResolverFn
}) {
  const [search, setSearch] = useState('')
  const selectedAccountId = useSelectedAccountId()
  const searchResults = useSearch(search, {
    perspectiveAccountUid: selectedAccountId ?? undefined,
  })

  // Handle URL/ID resolution inline in onChange to avoid useEffect re-render issues.
  const handleSearchChange = useCallback(
    (value: string) => {
      // Try direct hm:// parsing synchronously
      const hmUrl = unpackHmId(value)
      if (hmUrl) {
        const label = hmIdToURL(hmId(hmUrl.uid))
        if (label) {
          onValuesChange([...values, {id: hmUrl, label, unresolved: true}])
          setSearch('')
          return
        }
      }

      setSearch(value)

      // Try resolving full URLs asynchronously
      const isUrl = value.startsWith('http://') || value.startsWith('https://')
      if (isUrl) {
        resolveHypermediaUrl(value, {domainResolver})
          .then((resolved) => {
            if (!resolved?.hmId) return
            const resolvedId = hmId(resolved.hmId.uid)
            const label = resolved.title || hmIdToURL(resolvedId) || resolved.hmId.uid
            onValuesChange([...values, {id: resolvedId, label, unresolved: true}])
            setSearch('')
          })
          .catch(() => {})
      }
    },
    [values, onValuesChange, domainResolver],
  )

  const matches = useMemo(() => {
    const matchesByAccountUid = new Map<string, SearchResult & {type: string}>()
    const orderedAccountUids: string[] = []
    const excluded = new Set(excludeUids ?? [])

    for (const result of search ? searchResults.data?.entities || [] : []) {
      if (!result) continue // probably id was not parsed correctly
      if (result.id.path?.length) continue // this is a directory document, not an account
      if (excluded.has(result.id.uid)) continue // owner or already-added account
      if (values.find((value) => value.id.uid === result.id.uid)) continue // already selected
      if (result.type !== 'contact' && result.type !== 'document') continue

      const match = {
        id: result.id,
        label: result.title,
        type: result.type,
        metadata: result.metadata,
      }
      const existing = matchesByAccountUid.get(result.id.uid)
      if (!existing) {
        matchesByAccountUid.set(result.id.uid, match)
        orderedAccountUids.push(result.id.uid)
      } else if (existing.type !== 'contact' && result.type === 'contact') {
        // Prefer real profile/contact results, but keep root account documents as a legacy fallback.
        matchesByAccountUid.set(result.id.uid, match)
      }
    }

    return orderedAccountUids.map((uid) => matchesByAccountUid.get(uid)!).filter(Boolean)
  }, [search, searchResults.data?.entities, values, excludeUids])

  return (
    <div className="flex flex-1">
      <AccountTagInput
        label={label}
        value={search}
        onChange={handleSearchChange}
        values={values}
        onValuesChange={onValuesChange}
        placeholder={placeholder}
      >
        {matches.map(
          (result) =>
            result && (
              <AccountTagInputItem
                key={result.id.id}
                onClick={() => {
                  onValuesChange([...values, result])
                }}
                account={result}
              >
                Add &quot;{result?.label}&quot;
              </AccountTagInputItem>
            ),
        )}
        {search && matches.length == 0 ? (
          <AccountTagInputItem
            onClick={async () => {
              // Try resolving bare domains (e.g. "gabo.es")
              if (search.includes('.')) {
                const url = search.startsWith('http') ? search : `https://${search}`
                try {
                  const resolved = await resolveHypermediaUrl(url, {domainResolver})
                  if (resolved?.hmId) {
                    const resolvedId = hmId(resolved.hmId.uid)
                    const label = resolved.title || hmIdToURL(resolvedId) || resolved.hmId.uid
                    onValuesChange([...values, {id: resolvedId, label, unresolved: true}])
                    setSearch('')
                    return
                  }
                } catch {}
              }
              toast.error('Invalid account input')
            }}
          >
            Add &quot;{search}&quot;
          </AccountTagInputItem>
        ) : null}
      </AccountTagInput>
    </div>
  )
}

export function CollaboratorsEmpty() {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16">
      <Users className="text-muted-foreground size-16" />
      <SizableText color="muted" weight="medium" size="xl">
        No collaborators yet
      </SizableText>
      <SizableText color="muted" size="sm">
        Add collaborators to share access to this document
      </SizableText>
    </div>
  )
}

function getRoleDisplayName(role: string | undefined): string {
  if (role === 'writer') return 'Writer'
  if (role === 'agent') return 'Device'
  if (role === 'owner') return 'Owner'
  if (role === 'member') return 'Member'
  return role || 'Unknown'
}

/** Publisher/Owner display component */
function PublisherCollaborator({uid, siteUid, account}: {uid: string; siteUid: string; account?: HMMetadataPayload}) {
  const publisherId = hmId(uid)
  const linkProps = useRouteLink({
    key: 'site-profile',
    id: hmId(siteUid),
    accountUid: uid !== siteUid ? uid : undefined,
    tab: 'profile',
  })

  const metadata = account?.metadata

  return (
    <a {...linkProps} className="hover:bg-muted flex items-center gap-3 rounded-md p-3 transition-colors">
      <HMIcon id={publisherId} name={metadata?.name} icon={metadata?.icon} size={32} />
      <div className="flex flex-1 items-center gap-2 overflow-hidden">
        <SizableText size="sm" className={`truncate ${metadata?.name ? '' : 'text-muted-foreground'}`}>
          {metadata?.name || abbreviateUid(uid)}
        </SizableText>
        <SizableText size="xs" color="muted" className="ml-auto shrink-0">
          Publisher
        </SizableText>
      </div>
    </a>
  )
}

function CollaboratorListItem({
  capability,
  docId,
  account,
}: {
  capability: HMCapability
  docId: UnpackedHypermediaId
  account?: HMMetadataPayload
}) {
  const collaboratorId = hmId(capability.accountUid)
  const linkProps = useRouteLink({
    key: 'site-profile',
    id: hmId(docId.uid),
    accountUid: capability.accountUid !== docId.uid ? capability.accountUid : undefined,
    tab: 'profile',
  })

  const metadata = account?.metadata
  const isParentCapability = capability.grantId.id !== docId.id

  return (
    <a {...linkProps} className="hover:bg-muted flex items-center gap-3 rounded-md p-3 transition-colors">
      <HMIcon id={collaboratorId} name={metadata?.name} icon={metadata?.icon} size={32} />
      <div className="flex flex-1 items-center gap-2 overflow-hidden">
        <SizableText size="sm" className={`truncate ${metadata?.name ? '' : 'text-muted-foreground'}`}>
          {metadata?.name || abbreviateUid(capability.accountUid)}
        </SizableText>
        <SizableText size="xs" color="muted" className="ml-auto shrink-0">
          {getRoleDisplayName(capability.role)}
          {isParentCapability ? ' (Parent Capability)' : ''}
        </SizableText>
      </div>
    </a>
  )
}

export function CollaboratorsPage({
  docId,
  domainResolver,
}: {
  docId: UnpackedHypermediaId
  domainResolver?: DomainResolverFn
}) {
  if (docId.path?.length) {
    return <DocumentCollaborators docId={docId} domainResolver={domainResolver} />
  } else {
    return <SiteMembers docId={docId} domainResolver={domainResolver} />
  }
}

function SiteMembers({docId, domainResolver}: {docId: UnpackedHypermediaId; domainResolver?: DomainResolverFn}) {
  const {accounts, grantedMembers, isInitialLoading, members} = useSiteMembers(docId)
  const myCapability = useSelectedAccountCapability(docId, 'owner')
  const addCapabilities = useAddCapabilities(docId)
  const [promotingAccountUid, setPromotingAccountUid] = useState<string | null>(null)
  if (isInitialLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner className="size-8" />
      </div>
    )
  }
  const hasNoMembers = grantedMembers.length === 0 && members.length === 0
  const promoteMember = (accountUid: string) => {
    if (!myCapability) return
    setPromotingAccountUid(accountUid)
    addCapabilities.mutate(
      {
        myCapability,
        collaboratorAccountIds: [accountUid],
        role: 'WRITER',
      },
      {
        onSuccess: () => {
          toast.success('Writer access granted')
        },
        onError: () => {
          toast.error('Failed to grant writer access')
        },
        onSettled: () => {
          setPromotingAccountUid(null)
        },
      },
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <AddCollaboratorForm id={docId} domainResolver={domainResolver} />
      <PublisherCollaborator uid={docId.uid} siteUid={docId.uid} account={accounts[docId.uid]} />
      {grantedMembers.length > 0 && (
        <div className="flex flex-col gap-1">
          {grantedMembers.map((member) => (
            <MemberListItem
              member={member}
              siteUid={docId.uid}
              account={accounts[member.account.uid]}
              key={member.account.uid}
              canAddAsWriter={false}
            />
          ))}
        </div>
      )}
      {members.length > 0 && (
        <div className="flex flex-col gap-1">
          {members.map((member) => (
            <MemberListItem
              member={member}
              siteUid={docId.uid}
              account={accounts[member.account.uid]}
              key={member.account.uid}
              canAddAsWriter={!!myCapability}
              isPromoting={promotingAccountUid === member.account.uid && addCapabilities.isLoading}
              onAddAsWriter={promoteMember}
            />
          ))}
        </div>
      )}
      {hasNoMembers && (
        <SizableText size="sm" color="muted" className="px-3 py-2">
          No additional members
        </SizableText>
      )}
    </div>
  )
}

function MemberListItem({
  member,
  siteUid,
  account,
  canAddAsWriter,
  isPromoting,
  onAddAsWriter,
}: {
  member: HMSiteMember
  siteUid: string
  account?: HMMetadataPayload
  canAddAsWriter?: boolean
  isPromoting?: boolean
  onAddAsWriter?: (accountUid: string) => void
}) {
  const linkProps = useRouteLink({
    key: 'site-profile',
    id: hmId(siteUid),
    accountUid: member.account.uid !== siteUid ? member.account.uid : undefined,
    tab: 'profile',
  })

  const metadata = account?.metadata
  const showAddAsWriter = canAddAsWriter && member.role === 'member'

  return (
    <div className="group hover:bg-muted flex items-center gap-3 rounded-md p-3 transition-colors">
      <HMIcon id={member.account} name={metadata?.name} icon={metadata?.icon} size={32} />
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        <a
          {...linkProps}
          className={`focus-visible:ring-ring min-w-0 flex-1 truncate rounded-sm outline-none hover:underline focus-visible:ring-2 ${
            metadata?.name ? '' : 'text-muted-foreground'
          }`}
        >
          <SizableText size="sm" className="truncate">
            {metadata?.name || abbreviateUid(member.account.uid)}
          </SizableText>
        </a>
        {showAddAsWriter ? (
          <Button
            type="button"
            size="xs"
            variant="outline"
            loading={isPromoting}
            className="[@media(hover:hover)_and_(pointer:fine)]:opacity-0 [@media(hover:hover)_and_(pointer:fine)]:transition-opacity [@media(hover:hover)_and_(pointer:fine)]:group-focus-within:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:group-hover:opacity-100"
            onClick={() => onAddAsWriter?.(member.account.uid)}
          >
            Add as writer
          </Button>
        ) : null}
        <SizableText size="xs" color="muted" className="shrink-0">
          {getRoleDisplayName(member.role)}
        </SizableText>
      </div>
    </div>
  )
}

function DocumentCollaborators({
  docId,
  domainResolver,
}: {
  docId: UnpackedHypermediaId
  domainResolver?: DomainResolverFn
}) {
  const {accounts, parentCapabilities, grantedCapabilities, publisherUid, isInitialLoading} = useCollaborators(docId)

  if (isInitialLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner className="size-8" />
      </div>
    )
  }

  const hasNoCollaborators = parentCapabilities.length === 0 && grantedCapabilities.length === 0

  return (
    <div className="flex flex-col gap-4">
      <AddCollaboratorForm id={docId} domainResolver={domainResolver} />

      {/* Publisher always shown first */}
      <PublisherCollaborator uid={publisherUid} siteUid={docId.uid} account={accounts[publisherUid]} />

      {/* Parent capabilities section */}
      {parentCapabilities.length > 0 && (
        <div className="flex flex-col gap-1">
          {parentCapabilities.map((cap) => (
            <CollaboratorListItem
              key={cap.accountUid}
              capability={cap}
              docId={docId}
              account={accounts[cap.accountUid]}
            />
          ))}
        </div>
      )}

      {/* Granted section */}
      {grantedCapabilities.length > 0 && (
        <div className="flex flex-col gap-1">
          <SizableText size="xs" color="muted" className="px-3 py-2">
            Granted
          </SizableText>
          {grantedCapabilities.map((cap) => (
            <CollaboratorListItem
              key={cap.accountUid}
              capability={cap}
              docId={docId}
              account={accounts[cap.accountUid]}
            />
          ))}
        </div>
      )}

      {hasNoCollaborators && (
        <SizableText size="sm" color="muted" className="px-3 py-2">
          No additional collaborators
        </SizableText>
      )}
    </div>
  )
}
