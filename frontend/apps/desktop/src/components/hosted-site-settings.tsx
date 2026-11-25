import type {PendingSiteMove} from '@/app-host'
import {SeedHostLogin} from '@/components/publish-site'
import {HostedSite, useHostSession} from '@/models/host'
import {updateMovedSitePublication} from '@/models/site'
import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {Button} from '@shm/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shm/ui/components/dialog'
import {Input} from '@shm/ui/components/input'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {useState} from 'react'

/** Hosting management appears only for sites returned by the signed-in owner's hosting account. */
export function HostedSiteSettings({siteId, siteUrl}: {siteId: UnpackedHypermediaId; siteUrl: string}) {
  const host = useHostSession({includeSites: true})
  const [loginOpen, setLoginOpen] = useState(false)
  const [action, setAction] = useState<{type: 'rename' | 'transfer'; site: HostedSite} | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [movedUrl, setMovedUrl] = useState<string | null>(null)
  const pendingMoves = host.pendingSiteMoves?.filter((move) => move.siteUid === siteId.uid) || []
  const sites = host.loggedIn
    ? host.sites.data?.filter(
        (site) =>
          site.activeConfig?.registeredAccountUid === siteId.uid &&
          (site.url === siteUrl || (URL.canParse(siteUrl) && site.customDomains.includes(new URL(siteUrl).hostname))),
      )
    : []

  function openAction(type: 'rename' | 'transfer', site: HostedSite) {
    setAction({type, site})
    setName(site.name)
    setEmail('')
    setConfirmation('')
    setError(null)
    setMovedUrl(null)
  }

  async function submit() {
    if (!action || busy || confirmation !== action.site.name) return
    setBusy(true)
    setError(null)
    try {
      if (action.type === 'rename') {
        // Retain the successful move if publishing fails, so Retry only updates metadata.
        const pendingMove = pendingMoves.find((move) => move.id === action.site.id && move.newName === name)
        const newUrl =
          movedUrl ||
          (pendingMove
            ? await host.recoverSiteMove.mutateAsync(pendingMove)
            : (
                await host.renameSite.mutateAsync({
                  id: action.site.id,
                  currentName: action.site.name,
                  name,
                  siteUid: siteId.uid,
                  currentUrl: action.site.url,
                })
              ).url)
        setMovedUrl(newUrl)
        await updateMovedSitePublication(siteId, action.site.url, newUrl)
        await host.clearPendingSiteMove(action.site.id)
        toast.success('Site address updated')
      } else {
        const result = await host.transferSite.mutateAsync({
          id: action.site.id,
          currentName: action.site.name,
          email,
        })
        toast.success(`Hosting transferred to ${result.email}`)
      }
      setAction(null)
      setMovedUrl(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to update hosting. Try again.')
    } finally {
      setBusy(false)
    }
  }

  async function repairMove(move: PendingSiteMove) {
    setBusy(true)
    setError(null)
    try {
      const newUrl = await host.recoverSiteMove.mutateAsync(move)
      await updateMovedSitePublication(siteId, move.oldUrl, newUrl)
      await host.clearPendingSiteMove(move.id)
      toast.success('Site address updated')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to finish the move. Try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!host.isSessionLoaded) return null
  return (
    <>
      {pendingMoves.map((move) => (
        <div className="border-border flex flex-col gap-2 rounded-lg border p-4" key={move.id}>
          <SizableText weight="medium">Finish site address change</SizableText>
          <SizableText size="sm" color="muted">
            The move from {move.oldName} to {move.newName} still needs to be completed.
          </SizableText>
          {host.loggedIn && host.email === move.email ? (
            <Button
              variant="outline"
              className="self-start"
              disabled={busy}
              loading={busy}
              onClick={() => void repairMove(move)}
            >
              Resume Address Change
            </Button>
          ) : (
            <SizableText size="sm" color="muted">
              Sign in as {move.email} to resume.
            </SizableText>
          )}
          {error && !action ? (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ))}
      {!host.loggedIn ? (
        <Button variant="outline" className="self-start" onClick={() => setLoginOpen(true)}>
          Sign in to Seed Hosting
        </Button>
      ) : null}
      {host.loggedIn && host.sites.isInitialLoading ? (
        <SizableText size="sm" color="muted">
          Loading hosting settings…
        </SizableText>
      ) : null}
      {host.loggedIn && host.sites.isError ? (
        <div className="flex flex-col gap-2">
          <SizableText size="sm" color="muted">
            Unable to load hosting settings.
          </SizableText>
          <Button variant="outline" className="self-start" onClick={() => host.sites.refetch()}>
            Retry Hosting Settings
          </Button>
        </div>
      ) : null}
      {sites?.map((site) => {
        const pendingMove = pendingMoves.some((move) => move.id === site.id)
        const paidService = site.services.some((service) => !service.serviceEnd)
        const dedicatedService = site.services.some(
          (service) => !service.serviceEnd && service.plan.dedicatedServerType,
        )
        return (
          <div className="border-border flex flex-col gap-3 rounded-lg border p-4" key={site.id}>
            <div className="flex flex-col gap-1">
              <SizableText weight="medium">Seed Hosting</SizableText>
              <SizableText size="sm" color="muted">
                {site.url}
              </SizableText>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={dedicatedService || pendingMove}
                onClick={() => openAction('rename', site)}
              >
                Change Site Address
              </Button>
              <Button
                variant="outline"
                disabled={paidService || pendingMove}
                onClick={() => openAction('transfer', site)}
              >
                Transfer Hosting
              </Button>
            </div>
            {paidService ? (
              <SizableText size="sm" color="muted">
                Stop the paid service in Seed Hosting before transferring.
                {dedicatedService ? ' Stop dedicated hosting before changing the address.' : ''}
              </SizableText>
            ) : null}
          </div>
        )
      })}
      <Dialog open={loginOpen} onOpenChange={setLoginOpen}>
        <DialogContent className="w-full max-w-md">
          <SeedHostLogin onAuthenticated={() => setLoginOpen(false)} onBack={() => setLoginOpen(false)} />
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!action}
        onOpenChange={(open) => {
          if (!open && !busy) setAction(null)
        }}
      >
        <DialogContent className="w-full max-w-md" showCloseButton={!busy}>
          {action ? (
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault()
                void submit()
              }}
            >
              <DialogHeader>
                <DialogTitle>{action.type === 'rename' ? 'Change Site Address' : 'Transfer Hosting'}</DialogTitle>
                <DialogDescription>
                  {action.type === 'rename'
                    ? 'The old hosting address will stop working. Your space and its content stay the same.'
                    : 'Move this site to another Seed Hosting account. This does not transfer ownership of the Seed space.'}
                </DialogDescription>
              </DialogHeader>
              {action.type === 'rename' ? (
                <>
                  <label className="flex flex-col gap-2 text-sm font-medium">
                    New subdomain
                    <Input
                      value={name}
                      disabled={busy || !!movedUrl || pendingMoves.some((move) => move.id === action.site.id)}
                      required
                      maxLength={63}
                      pattern="[a-z0-9]([a-z0-9-]*[a-z0-9])?"
                      onChangeText={setName}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                    />
                  </label>
                  <SizableText size="sm" color="muted">
                    {action.site.url.replace(`//${action.site.name}.`, `//${name}.`)}
                  </SizableText>
                  {siteUrl !== action.site.url ? (
                    <SizableText size="sm" color="muted">
                      Your published domain stays at {siteUrl}.
                    </SizableText>
                  ) : null}
                </>
              ) : (
                <>
                  <label className="flex flex-col gap-2 text-sm font-medium">
                    Recipient email
                    <Input
                      type="email"
                      value={email}
                      required
                      disabled={busy}
                      onChangeText={setEmail}
                      autoComplete="email"
                    />
                  </label>
                  <SizableText size="sm" color="muted">
                    The recipient must have signed in to Seed Hosting. You will lose hosting controls for this site.
                  </SizableText>
                </>
              )}
              {!movedUrl ? (
                <label className="flex flex-col gap-2 text-sm font-medium">
                  Type {action.site.name} to confirm
                  <Input
                    value={confirmation}
                    required
                    disabled={busy}
                    onChangeText={setConfirmation}
                    autoComplete="off"
                  />
                </label>
              ) : (
                <SizableText size="sm">
                  The hosting address has changed. Finish updating the space publication below.
                </SizableText>
              )}
              {error ? (
                <p className="text-destructive text-sm" role="alert">
                  {error}
                </p>
              ) : null}
              <DialogFooter>
                <Button type="button" variant="ghost" disabled={busy} onClick={() => setAction(null)}>
                  {movedUrl ? 'Close' : 'Cancel'}
                </Button>
                <Button
                  type="submit"
                  variant={action.type === 'transfer' ? 'destructive' : 'default'}
                  loading={busy}
                  disabled={
                    busy ||
                    confirmation !== action.site.name ||
                    (action.type === 'rename' && !movedUrl && name === action.site.name)
                  }
                >
                  {movedUrl
                    ? 'Retry Publication Update'
                    : action.type === 'rename'
                      ? 'Change Address'
                      : 'Transfer Hosting'}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  )
}
