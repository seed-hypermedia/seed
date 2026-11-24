/**
 * Host config, shared by apps and agents (hypermedia/build/signed-api-apps.md, "Host config"):
 * which private config fields a host has set on its server, its signing keys, and what each key
 * may write. App settings and an agent's Private config page use the same pieces.
 */
import type {HostConfigInfo, SigningIdentity} from '@seed-hypermedia/apps-protocol'
import {createCapability} from '@seed-hypermedia/client'
import type {HMCapability, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useCapabilities} from '@shm/shared/models/entity'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useUniversalAppContext, useUniversalClient} from '@shm/shared/routing'
import {abbreviateUid} from '@shm/shared/utils/abbreviate'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'
import {KeyRound, Plus, X} from 'lucide-react'
import {useState} from 'react'
import {sendAgentAction} from '../agents/client'
import {useCreateSigningIdentity, useSigningIdentities} from '../agents/models'
import {SigningIdentityIcon} from '../agents/signing-identity-icon'
import {Button} from '../button'
import {Input} from '../components/input'
import {OptionsDropdown} from '../options-dropdown'
import {SizableText} from '../text'
import {toast} from '../toast'
import {useAccountUid} from './running'

/** The schema kind of a private config field that names a signing key the server holds. */
export const SIGNING_KEY_KIND = 'signing-key'

/** A host's config on its server: which private fields are set, its signing keys (never values). */
export function useHostConfig(serverUrl: string | undefined, hostId: string) {
  const accountUid = useAccountUid()
  return useQuery({
    queryKey: ['host-config', serverUrl, hostId],
    enabled: !!serverUrl && !!accountUid,
    retry: false,
    useErrorBoundary: false,
    queryFn: async () => {
      const response = (await sendAgentAction({
        serverUrl: serverUrl!,
        accountUid: accountUid!,
        action: {_: 'GetHostConfig', hostId} as never,
      })) as unknown as {config: HostConfigInfo}
      return response.config
    },
  })
}

/** Changes private config fields on the host's server: a value replaces a field, null removes it. */
export function useSetHostPrivateConfig(serverUrl: string | undefined, hostId: string) {
  const accountUid = useAccountUid()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (privateConfig: Record<string, unknown>) => {
      if (!serverUrl || !accountUid) throw new Error('Select an account and a server first')
      const response = (await sendAgentAction({
        serverUrl,
        accountUid,
        action: {_: 'SetHostPrivateConfig', hostId, privateConfig} as never,
      })) as unknown as {config: HostConfigInfo}
      return response.config
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({queryKey: ['host-config']})
      void queryClient.invalidateQueries({queryKey: ['app-run']})
      invalidateQueries(['agents'])
    },
  })
}

/** A key the server holds, as a pill: its account's icon and name. */
export function SigningKeyChip({identity, account}: {identity?: SigningIdentity; account: string}) {
  const name = identity?.label || abbreviateUid(account)
  return (
    <span className="flex min-w-0 items-center gap-2">
      <SigningIdentityIcon identity={identity ?? {accountId: account}} name={name} size={20} />
      <span className="truncate text-sm font-medium">{name}</span>
    </span>
  )
}

/**
 * Picks one of the keys the signed-in account holds on the server, or makes a new one there. The
 * server accepts only keys the person attaching them holds, so others' keys are never offered.
 */
export function SigningKeyPicker({
  serverUrl,
  exclude = [],
  label,
  disabled,
  onPick,
}: {
  serverUrl: string | undefined
  /** Accounts already chosen, not offered again. */
  exclude?: string[]
  label: string
  disabled?: boolean
  onPick: (account: string) => void
}) {
  const accountUid = useAccountUid()
  const identities = useSigningIdentities(serverUrl, accountUid)
  const create = useCreateSigningIdentity(serverUrl, accountUid)
  const [naming, setNaming] = useState<string | null>(null)
  const offered = (identities.data ?? []).filter(
    (identity) => identity.accountId && !exclude.includes(identity.accountId),
  )
  if (naming !== null)
    return (
      <form
        className="flex items-center gap-2"
        onSubmit={async (event) => {
          event.preventDefault()
          try {
            const response = (await create.mutateAsync(naming.trim() || undefined)) as {identity?: SigningIdentity}
            if (response.identity?.accountId) onPick(response.identity.accountId)
            setNaming(null)
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not create the key')
          }
        }}
      >
        <Input
          autoFocus
          className="h-8 w-48"
          placeholder="Key name"
          value={naming}
          onChange={(event) => setNaming(event.target.value)}
        />
        <Button size="sm" type="submit" disabled={create.isLoading}>
          {create.isLoading ? 'Creating…' : 'Create'}
        </Button>
        <Button size="sm" variant="ghost" type="button" onClick={() => setNaming(null)}>
          Cancel
        </Button>
      </form>
    )
  return (
    <OptionsDropdown
      ariaLabel={label}
      button={
        <Button variant="outline" size="sm" disabled={disabled || identities.isLoading}>
          <KeyRound className="size-4" />
          {label}
        </Button>
      }
      menuItems={[
        ...offered.map((identity) => ({
          key: identity.id,
          label: identity.label || identity.accountId || identity.name,
          icon: <SigningIdentityIcon identity={identity} name={identity.label} size={20} />,
          onClick: () => onPick(identity.accountId!),
        })),
        {key: 'new', label: 'New key…', icon: <Plus className="size-4" />, onClick: () => setNaming('')},
      ]}
    />
  )
}

/** Where a key's account may write in a space: the capabilities granted to it there. */
export function keyWriteScopes(capabilities: HMCapability[] | undefined, account: string, space: string) {
  return (capabilities ?? [])
    .filter(
      (cap) =>
        cap.accountUid === account && cap.grantId.uid === space && (cap.role === 'writer' || cap.role === 'agent'),
    )
    .map((cap) => (cap.role === 'agent' ? [] : cap.grantId.path ?? []))
}

/**
 * What a key may write in the host's space, and Add access for the space's owner. A key is an
 * account, so its reach is the capabilities granted to it; anyone who can edit the host can act
 * as its keys, which is why the default grants are narrow (the host's own places).
 */
export function SigningKeyAccess({
  account,
  space,
  places,
}: {
  account: string
  space: string
  /** Where this key would usually need to write (the host's collections), offered first. */
  places: {label: string; id: UnpackedHypermediaId}[]
}) {
  const accountUid = useAccountUid()
  const client = useUniversalClient()
  const {onPushPublished} = useUniversalAppContext()
  const capabilities = useCapabilities(hmId(space))
  const scopes = keyWriteScopes(capabilities.data, account, space)
  const covers = (path: string[]) =>
    scopes.some((scope) => scope.length <= path.length && scope.every((segment, index) => path[index] === segment))
  const grant = useMutation({
    mutationFn: async (id: UnpackedHypermediaId) => {
      if (accountUid !== space) throw new Error('Only the owner of this space can grant write access here')
      if (!client.getSigner) throw new Error('Signing is unavailable')
      const path = id.path?.length ? '/' + id.path.join('/') : undefined
      await client.publish(
        await createCapability(
          {delegateUid: account, role: 'WRITER', path, label: 'Host key access'},
          client.getSigner(space),
        ),
      )
      invalidateQueries([queryKeys.CAPABILITIES, space])
      onPushPublished?.(hmId(space))
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not grant access'),
  })
  const label = (path: string[]) =>
    path.length
      ? places.find((place) => (place.id.path ?? []).join('/') === path.join('/'))?.label ?? `/${path.join('/')}`
      : 'The whole space'
  const offered = places.filter((place) => !covers(place.id.path ?? []))
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <SizableText size="xs" color="muted">
        Can write:
      </SizableText>
      {capabilities.isLoading ? (
        <SizableText size="xs" color="muted">
          …
        </SizableText>
      ) : scopes.length ? (
        scopes.map((scope) => (
          <span key={scope.join('/') || '/'} className="bg-muted rounded-full px-2 py-0.5">
            {label(scope)}
          </span>
        ))
      ) : (
        <SizableText size="xs" color="muted">
          nothing yet
        </SizableText>
      )}
      {accountUid === space && offered.length ? (
        <OptionsDropdown
          ariaLabel="Add write access"
          button={
            <Button variant="ghost" size="xs" disabled={grant.isLoading}>
              <Plus className="size-3.5" />
              Add access
            </Button>
          }
          menuItems={offered.map((place) => ({
            key: place.id.id,
            label: place.label,
            icon: <Plus className="size-4" />,
            onClick: () => grant.mutate(place.id),
          }))}
        />
      ) : null}
    </div>
  )
}

/** One attached key: who it is, what it may write, and the owner's actions on it. */
export function SigningKeyRow({
  account,
  identity,
  space,
  places,
  badge,
  actions,
  onRemove,
}: {
  account: string
  identity?: SigningIdentity
  space: string
  places: {label: string; id: UnpackedHypermediaId}[]
  badge?: string
  actions?: React.ReactNode
  onRemove?: () => void
}) {
  return (
    <div className="group/key border-border bg-card grid gap-2 rounded-xl border px-4 py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <SigningKeyChip identity={identity} account={account} />
        </div>
        {badge ? (
          <span className="bg-primary/10 text-primary shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase">
            {badge}
          </span>
        ) : null}
        {actions}
        {onRemove ? (
          <Button
            variant="ghost"
            size="iconSm"
            className="text-muted-foreground hover:text-destructive"
            aria-label="Detach this key"
            onClick={onRemove}
          >
            <X className="size-3.5" />
          </Button>
        ) : null}
      </div>
      <SigningKeyAccess account={account} space={space} places={places} />
    </div>
  )
}
