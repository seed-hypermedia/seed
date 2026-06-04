import {HMCapability, HMMetadataPayload, HMSiteMember, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {resolveHypermediaUrl, type DomainResolverFn} from '@seed-hypermedia/client'
import {useRouteLink} from '@shm/shared'
import {useAddCapabilities, useSelectedAccountCapability} from '@shm/shared/models/capabilities'
import {useCapabilities, useCollaborators, useSelectedAccountId, useSiteMembers} from '@shm/shared/models/entity'
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

type SearchResult = AccountSearchResult

function AddCollaboratorForm({id, domainResolver}: {id: UnpackedHypermediaId; domainResolver?: DomainResolverFn}) {
  const myCapability = useSelectedAccountCapability(id, 'owner')
  const addCapabilities = useAddCapabilities(id)
  const [selectedCollaborators, setSelectedCollaborators] = useState<SearchResult[]>([])
  const capabilities = useCapabilities(id)
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
          setSelectedCollaborators((v) => [...v, {id: hmUrl, label, unresolved: true}])
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
            setSelectedCollaborators((v) => [...v, {id: resolvedId, label, unresolved: true}])
            setSearch('')
          })
          .catch(() => {})
      }
    },
    [domainResolver],
  )

  const matches = useMemo(
    () =>
      (search ? searchResults.data?.entities : [])
        ?.map((result) => {
          return {
            id: result.id,
            label: result.title,
            type: result.type,
            metadata: result.metadata,
          }
        })
        .filter((result) => {
          if (!result) return false // probably id was not parsed correctly
          if (result.type == 'contact') return true
          if (result.id.path?.length) return false // this is a directory document, not an account
          if (result.id.uid === id.uid) return false // this account is already the owner, cannot be added
          if (result.type == 'document') return true // this is a directory document, not an account
          if (capabilities.data?.find((capability) => capability.grantId.uid === result.id.uid)) return false // already added
          if (selectedCollaborators.find((collab) => collab.id.id === result.id.id)) return false // already added

          // this is temporarily disabled because the API is not returning the `&l` flag correctly
          // if (!result.id.latest) return false // this is not the latest version

          return true
        }) || [],
    [search, searchResults, selectedCollaborators, capabilities.data],
  )

  if (!myCapability) return null
  return (
    <div className="flex flex-col gap-2 px-4 pt-4">
      <div className="border-border flex overflow-hidden rounded-md border-1">
        <div className="flex flex-1">
          <AccountTagInput
            label="Members"
            value={search}
            onChange={handleSearchChange}
            values={selectedCollaborators}
            onValuesChange={(collabs) => {
              setSelectedCollaborators(collabs)
            }}
            placeholder="Invite members"
          >
            {matches.map(
              (result) =>
                result && (
                  <AccountTagInputItem
                    key={result.id.id}
                    onClick={() => {
                      setSelectedCollaborators((vals) => [...vals, result])
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
                        setSelectedCollaborators((v) => [...v, {id: resolvedId, label, unresolved: true}])
                        setSearch('')
                        return
                      }
                    } catch {}
                  }
                  toast.error('Invalid Collaborator Input')
                }}
              >
                Add &quot;{search}&quot;
              </AccountTagInputItem>
            ) : null}
          </AccountTagInput>
        </div>
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
              setSearch('')
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
  if (isInitialLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Spinner className="size-8" />
      </div>
    )
  }
  const hasNoMembers = grantedMembers.length === 0 && members.length === 0
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
}: {
  member: HMSiteMember
  siteUid: string
  account?: HMMetadataPayload
}) {
  const linkProps = useRouteLink({
    key: 'site-profile',
    id: hmId(siteUid),
    accountUid: member.account.uid !== siteUid ? member.account.uid : undefined,
    tab: 'profile',
  })

  const metadata = account?.metadata

  return (
    <a {...linkProps} className="hover:bg-muted flex items-center gap-3 rounded-md p-3 transition-colors">
      <HMIcon id={member.account} name={metadata?.name} icon={metadata?.icon} size={32} />
      <div className="flex flex-1 items-center gap-2 overflow-hidden">
        <SizableText size="sm" className={`truncate ${metadata?.name ? '' : 'text-muted-foreground'}`}>
          {metadata?.name || abbreviateUid(member.account.uid)}
        </SizableText>
        <SizableText size="xs" color="muted" className="ml-auto shrink-0">
          {getRoleDisplayName(member.role)}
        </SizableText>
      </div>
    </a>
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
