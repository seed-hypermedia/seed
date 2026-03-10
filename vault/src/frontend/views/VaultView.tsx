import {AccountProfileDialog} from '@/frontend/components/AccountProfileDialog'
import {CreateAccountDialog} from '@/frontend/components/CreateAccountDialog'
import {ErrorMessage} from '@/frontend/components/ErrorMessage'
import {Alert, AlertDescription, AlertTitle} from '@/frontend/components/ui/alert'
import {Button} from '@/frontend/components/ui/button'
import {getProfileDisplayName, type AccountProfileSummary, type ProfileLoadState} from '@/frontend/profile'
import {Separator} from '@/frontend/components/ui/separator'
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from '@/frontend/components/ui/tooltip'
import {useActions, useAppState} from '@/frontend/store'
import type * as vault from '@/frontend/vault'
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy} from '@dnd-kit/sortable'
import {CSS} from '@dnd-kit/utilities'
import * as blobs from '@shm/shared/blobs'
import {AlertTriangle, Check, Copy, GripVertical, Monitor, Plus, Settings, Smartphone, Tablet, User} from 'lucide-react'
import {useEffect, useState} from 'react'
import {useNavigate} from 'react-router-dom'

function getProfileStatusTextClass(profileLoadState?: ProfileLoadState) {
  if (profileLoadState === 'not_found') return 'text-yellow-700 dark:text-yellow-400'
  if (profileLoadState === 'unavailable') return 'text-destructive'
  return ''
}

/**
 * Main vault view displaying an identity wallet with account management.
 * Uses a two-panel layout: sidebar with account list, main panel with account details.
 * Vault-level settings (credentials, email) live in a separate SettingsView.
 */
export function VaultView() {
  const {vaultData, selectedAccountIndex, creatingAccount, error, profiles, profileLoadStates} = useAppState()
  const actions = useActions()
  const navigate = useNavigate()

  const accounts = vaultData?.accounts ?? []
  const hasAccounts = accounts.length > 0
  const selectedAccount = actions.getSelectedAccount()
  const selectedPrincipal = selectedAccount
    ? blobs.principalToString(blobs.nobleKeyPairFromSeed(selectedAccount.seed).principal)
    : null

  useEffect(() => {
    accounts.forEach((account) => {
      const kp = blobs.nobleKeyPairFromSeed(account.seed)
      const principal = blobs.principalToString(kp.principal)
      actions.ensureProfileLoaded(principal)
    })
  }, [accounts, actions])

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  function handleDragEnd(event: DragEndEvent) {
    const {active, over} = event
    if (over && active.id !== over.id) {
      actions.reorderAccount(active.id as string, over.id as string)
    }
  }

  if (!hasAccounts) {
    return (
      <>
        {!creatingAccount && <ErrorMessage message={error} />}
        <EmptyState />
        <CreateAccountDialog />
      </>
    )
  }

  return (
    <>
      {!creatingAccount && <ErrorMessage message={error} />}
      <div className="bg-card flex min-h-[480px] overflow-hidden rounded-xl border">
        {/* Left sidebar */}
        <div className="flex w-[280px] shrink-0 flex-col border-r">
          <div className="flex items-center justify-between border-b p-4">
            <h2 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">Accounts</h2>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="icon-xs" onClick={() => navigate('/settings')}>
                    <Settings className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Vault Settings</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <div className="flex-1 overflow-y-auto">
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext
                items={accounts.map((a) => {
                  const kp = blobs.nobleKeyPairFromSeed(a.seed)
                  return blobs.principalToString(kp.principal)
                })}
                strategy={verticalListSortingStrategy}
              >
                {accounts.map((account, index) => {
                  const kp = blobs.nobleKeyPairFromSeed(account.seed)
                  const principal = blobs.principalToString(kp.principal)
                  const isSelected = index === selectedAccountIndex
                  return (
                    <SortableAccountItem
                      key={principal}
                      id={principal}
                      profile={profiles[principal]}
                      profileLoadState={profileLoadStates[principal]}
                      isSelected={isSelected}
                      onSelect={() => actions.selectAccount(index)}
                    />
                  )
                })}
              </SortableContext>
            </DndContext>
          </div>
          <div className="border-t p-3">
            <Button variant="outline" className="w-full" size="sm" onClick={() => actions.setCreatingAccount(true)}>
              <Plus className="size-4" />
              Create Account
            </Button>
          </div>
        </div>

        {/* Right panel */}
        <div className="flex-1 overflow-y-auto">
          {selectedAccount ? (
            <AccountDetails
              account={selectedAccount as unknown as vault.Account}
              profile={selectedPrincipal ? profiles[selectedPrincipal] : undefined}
              profileLoadState={selectedPrincipal ? profileLoadStates[selectedPrincipal] : undefined}
            />
          ) : (
            <div className="text-muted-foreground flex h-full items-center justify-center">
              <p>Select an account to view details</p>
            </div>
          )}
        </div>
      </div>
      <CreateAccountDialog />
    </>
  )
}

function EmptyState() {
  const actions = useActions()

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      <div className="bg-primary/10 mb-6 flex size-16 items-center justify-center rounded-full">
        <User className="text-primary size-8" />
      </div>
      <h2 className="mb-2 text-xl font-semibold">No accounts yet</h2>
      <p className="text-muted-foreground mb-6 max-w-sm">
        Create your first Hypermedia identity account to get started.
      </p>
      <Button size="lg" onClick={() => actions.setCreatingAccount(true)}>
        <Plus className="size-4" />
        Create your first Hypermedia Account
      </Button>
    </div>
  )
}

function SortableAccountItem({
  id,
  profile,
  profileLoadState,
  isSelected,
  onSelect,
}: {
  id: string
  profile?: AccountProfileSummary
  profileLoadState?: ProfileLoadState
  isSelected: boolean
  onSelect: () => void
}) {
  const {attributes, listeners, setNodeRef, transform, transition, isDragging} = useSortable({id})

  const name = getProfileDisplayName(profile, profileLoadState)
  const statusTextClass = getProfileStatusTextClass(profileLoadState)
  const Component = User

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
    position: 'relative' as const,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex w-full items-center gap-2 px-2 py-3 text-left transition-colors ${
        isSelected ? 'bg-accent' : 'hover:bg-muted/50'
      }`}
    >
      <div
        {...attributes}
        {...listeners}
        className="text-muted-foreground shrink-0 cursor-grab rounded p-1.5 hover:bg-black/5 active:cursor-grabbing"
      >
        <GripVertical className="size-4" />
      </div>
      <button type="button" className="flex min-w-0 flex-1 cursor-pointer items-center gap-3" onClick={onSelect}>
        <div className="bg-muted flex size-6 shrink-0 items-center justify-center overflow-hidden rounded-full">
          {profile?.avatar ? (
            <img src={profile.avatar} className="size-full object-cover" alt="" />
          ) : (
            <Component className="text-muted-foreground size-3" />
          )}
        </div>
        <div className="min-w-0 flex-1 text-left">
          <div className={`truncate text-sm font-medium ${statusTextClass}`}>{name}</div>
          <div className="text-muted-foreground truncate font-mono text-xs">{id.slice(0, 16)}…</div>
        </div>
      </button>
    </div>
  )
}

/** Account profile detail panel. Only shows identity information, not vault credentials. */
function AccountDetails({
  account,
  profile,
  profileLoadState,
}: {
  account: vault.Account
  profile?: AccountProfileSummary
  profileLoadState?: ProfileLoadState
}) {
  const {loading, error} = useAppState()
  const actions = useActions()
  const kp = blobs.nobleKeyPairFromSeed(account.seed)
  const principal = blobs.principalToString(kp.principal)
  const [copied, setCopied] = useState(false)
  const [editingProfile, setEditingProfile] = useState(false)
  const name = getProfileDisplayName(profile, profileLoadState)
  const statusTextClass = getProfileStatusTextClass(profileLoadState)
  const isProfileNotFound = profileLoadState === 'not_found'
  const canEditProfile = profileLoadState !== 'unavailable'
  const profileActionLabel = profile ? 'Edit Profile' : 'Create Profile'

  async function copyPrincipal() {
    try {
      await navigator.clipboard.writeText(principal)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API may not be available
    }
  }

  async function handleProfileSubmit(nextProfile: {name: string; description?: string}) {
    const didUpdate = await actions.updateAccountProfile(principal, nextProfile)
    if (didUpdate) {
      setEditingProfile(false)
    }
  }

  return (
    <div className="space-y-6 p-6">
      {/* Profile header */}
      <div className="flex items-start gap-4">
        <div className="bg-primary/10 flex size-14 shrink-0 items-center justify-center rounded-full">
          <User className="text-primary size-7" />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className={`text-2xl font-semibold ${statusTextClass}`}>{name}</h1>
          {profileLoadState && (
            <Alert variant={isProfileNotFound ? 'warning' : 'destructive'} className="mt-3">
              <AlertTriangle />
              <AlertTitle>
                {isProfileNotFound
                  ? 'No profile was found for this account'
                  : 'We hit an internal issue while loading this profile'}
              </AlertTitle>
              <AlertDescription>
                <p>
                  {isProfileNotFound
                    ? 'This account is still available and can be used normally, but there is no profile document for it.'
                    : 'You did nothing wrong. This account is still available and can be used normally.'}
                </p>
              </AlertDescription>
            </Alert>
          )}
          <div className="mt-1 flex items-center gap-2">
            <code className="text-muted-foreground truncate font-mono text-sm">{principal}</code>
            <Button variant="ghost" size="icon-xs" onClick={copyPrincipal} title="Copy principal">
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
            </Button>
          </div>
        </div>
      </div>

      <Separator />

      {/* Profile details */}
      <div className="space-y-4">
        {profile?.description && (
          <div>
            <h3 className="text-muted-foreground mb-1 text-sm font-medium">Description</h3>
            <p className="text-sm">{profile.description}</p>
          </div>
        )}

        {profile?.avatar && (
          <div>
            <h3 className="text-muted-foreground mb-1 text-sm font-medium">Avatar</h3>
            <p className="font-mono text-sm break-all">{profile.avatar}</p>
          </div>
        )}

        <div>
          <h3 className="text-muted-foreground mb-1 text-sm font-medium">Created</h3>
          <p className="text-sm">
            {new Date(account.createTime).toLocaleDateString(undefined, {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        </div>
      </div>

      <AuthorizedSessionsList account={account} />

      <Separator />

      <div>
        <div className="mb-3 space-y-2">
          <Button
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => setEditingProfile(true)}
            disabled={loading || !canEditProfile}
          >
            {profileActionLabel}
          </Button>
          {!canEditProfile && (
            <p className="text-muted-foreground text-xs">
              Profile editing is temporarily unavailable while the current profile state cannot be loaded.
            </p>
          )}
        </div>
        <DeleteAccountButton principal={principal} />
      </div>

      <AccountProfileDialog
        open={editingProfile}
        onOpenChange={setEditingProfile}
        title={profile ? 'Edit Profile' : 'Create Profile'}
        descriptionText={
          profile
            ? 'Update the public profile attached to this Hypermedia identity.'
            : 'Publish a profile for this Hypermedia identity so apps can display it correctly.'
        }
        submitLabel={profile ? 'Save Profile' : 'Create Profile'}
        loading={loading}
        error={error}
        initialName={profile?.name ?? ''}
        initialDescription={profile?.description ?? ''}
        onSubmit={handleProfileSubmit}
      />
    </div>
  )
}

function AuthorizedSessionsList({account}: {account: vault.Account}) {
  const sessions = account.delegations || []

  if (sessions.length === 0) {
    return null
  }

  return (
    <>
      <Separator />
      <div>
        <h3 className="mb-4 text-sm font-medium">Authorized Sessions</h3>
        <div className="space-y-0 rounded-md border text-sm">
          {sessions.map((session, index) => {
            const delegatePrincipal = blobs.principalToString(session.capability.delegate)
            const key = `${session.clientId}:${delegatePrincipal}`

            const isLast = index === sessions.length - 1

            // Determine Device Icon
            let DeviceIcon = Monitor
            if (session.deviceType === 'mobile') DeviceIcon = Smartphone
            if (session.deviceType === 'tablet') DeviceIcon = Tablet

            return (
              <div
                key={key}
                className={`flex flex-col justify-between gap-4 p-4 sm:flex-row sm:items-center ${
                  !isLast ? 'border-b' : ''
                }`}
              >
                <div className="flex min-w-0 flex-1 items-start gap-4">
                  <div className="mt-1">
                    <DeviceIcon className="text-muted-foreground size-6" strokeWidth={1.5} />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-base font-semibold">{session.clientId}</div>
                    <div className="text-muted-foreground mt-1 space-y-1">
                      <div className="text-[13px]">
                        {new Date(session.createTime).toLocaleString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                      <div className="cursor-help truncate font-mono text-xs">{delegatePrincipal}</div>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )
}

function DeleteAccountButton({principal}: {principal: string}) {
  const actions = useActions()
  const {loading} = useAppState()
  const [confirming, setConfirming] = useState(false)

  async function handleDelete() {
    if (confirming) {
      await actions.deleteAccount(principal)
    } else {
      setConfirming(true)
      // Reset confirmation after 3 seconds
      setTimeout(() => {
        setConfirming(false)
      }, 3000)
    }
  }

  return (
    <Button
      variant={confirming ? 'destructive' : 'outline'}
      className={
        confirming
          ? 'w-full sm:w-auto'
          : 'text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive w-full sm:w-auto'
      }
      onClick={handleDelete}
      disabled={loading}
    >
      {confirming ? 'Confirm Delete Account?' : 'Delete Account'}
    </Button>
  )
}
