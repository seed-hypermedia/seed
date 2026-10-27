import React from 'react'
import {Eye, PenLine, ShieldCheck, Upload} from 'lucide-react'
import {useQuery} from '@tanstack/react-query'
import {queryAccount} from '@shm/shared/models/queries'
import {useUniversalClient} from '@shm/shared/routing'
import {
  pagePermissionLabel,
  pagePermissionScopes,
  type PagePermissionDecision,
  type PagePermissionGrant,
  type PagePermissionRequest,
} from '@shm/shared/document-page-permissions'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from './components/alert-dialog'
import {Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription} from './components/dialog'
import {Button} from './button'

function PermissionTarget({site, resource}: {site?: string; resource?: string}) {
  const client = useUniversalClient()
  const account = useQuery(queryAccount(client, site || null))
  const path = resource?.replace(/^hm:\/\/[^/]+/, '')
  return site || path ? (
    <div className="border-border flex flex-col gap-1 border-b pb-3 text-sm">
      {site && <span className="font-medium">{account.data?.metadata?.name || 'Unnamed site'}</span>}
      {path && (
        <span className="text-muted-foreground break-all">
          {path === '/:profile' ? 'Account identity' : path || 'Home'}
        </span>
      )}
    </div>
  ) : null
}

/** Seed-owned action review with narrow defaults and an explanation of the selected policy. */
export function DocumentPagePermissionPrompt({
  request,
  pageName,
  accountName,
  onDecision,
}: {
  request: PagePermissionRequest
  pageName: string
  accountName: string
  onDecision: (decision: PagePermissionDecision) => void
}) {
  const [choice, setChoice] = React.useState<PagePermissionDecision>('once')
  const scopes = pagePermissionScopes(request)
  const policyDescription =
    choice === 'once'
      ? 'Allow this request only.'
      : choice === 'resource'
        ? 'This page can read this resource without asking again.'
        : choice === 'site'
          ? 'This page can read content on this site without asking again.'
          : choice === 'all'
            ? request.kind === 'read'
              ? 'This page can read everything available to your account without asking again.'
              : request.kind === 'sign'
                ? 'This page can sign anything as your account, including lasting account permissions, without asking again.'
                : 'This page can publish any data without asking again.'
            : `This page can ${request.kind === 'sign' ? 'sign' : 'publish'} future requests of this type${
                choice === 'type-site' ? ' on this site' : ' on any site'
              } without asking again.`
  const Icon = request.kind === 'read' ? Eye : request.kind === 'sign' ? PenLine : Upload
  const details = request.details as {
    payload?: {body?: {text?: string; children?: unknown[]}[]}
    sha256?: string
  } | null
  const comment = request.type === 'Comment' && Array.isArray(details?.payload?.body) ? details.payload.body : null
  const text = (blocks: unknown[]): string =>
    blocks
      .map((block) => {
        const value = block as {text?: string; children?: unknown[]}
        return [value.text || '', value.children ? text(value.children) : ''].filter(Boolean).join('\n')
      })
      .join('\n')
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onDecision('deny')
      }}
    >
      <AlertDialogContent className="max-h-screen overflow-y-auto sm:max-w-xl">
        <AlertDialogHeader>
          <div className="text-muted-foreground flex items-center gap-2 text-xs font-medium">
            <ShieldCheck className="size-4" />
            Seed · Page permissions
          </div>
          <AlertDialogTitle className="flex items-center gap-2">
            <Icon className="size-5 shrink-0" />
            {request.title}
          </AlertDialogTitle>
          <AlertDialogDescription>
            <strong className="text-foreground">{pageName}</strong> is asking to{' '}
            {request.kind === 'read' ? 'access data available to' : 'act as'}{' '}
            <strong className="text-foreground">{accountName}</strong>.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="bg-muted/40 border-border flex flex-col gap-3 rounded-lg border p-4">
          <PermissionTarget site={request.site} resource={request.resource} />
          {comment && (
            <p className="max-h-48 overflow-y-auto text-sm whitespace-pre-wrap">
              {text(comment) || 'Comment contains attachments or embedded content.'}
            </p>
          )}
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">Review exact request</summary>
            <pre className="mt-3 max-h-64 overflow-auto text-xs break-all whitespace-pre-wrap">
              {JSON.stringify(
                request.details,
                (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
                2,
              )}
            </pre>
          </details>
        </div>
        <p className="text-muted-foreground text-sm">
          {request.kind === 'read'
            ? 'Anything shared with this page could be copied or sent elsewhere. Revoking access cannot take it back.'
            : 'Approved signatures and published content can remain valid after you revoke access.'}
        </p>
        {request.warning && <p className="text-destructive text-sm">{request.warning}</p>}
        <fieldset className="flex flex-col gap-3">
          <legend className="sr-only">Permission scope</legend>
          <label className="border-border flex cursor-pointer items-start gap-3 rounded-lg border p-3">
            <input
              className="mt-1"
              type="radio"
              name="page-scope"
              value="once"
              checked={choice === 'once'}
              onChange={() => setChoice('once')}
            />
            <span className="text-sm font-medium">Only this time</span>
          </label>
          <details className="border-border rounded-lg border p-3">
            <summary className="cursor-pointer text-sm font-medium">Allow more like this…</summary>
            <div className="mt-3 flex flex-col gap-3">
              {scopes
                .filter((scope) => scope !== 'once')
                .map((scope) => (
                  <label key={scope} className="flex cursor-pointer items-start gap-3 text-sm">
                    <input
                      className="mt-1"
                      type="radio"
                      name="page-scope"
                      value={scope}
                      checked={choice === scope}
                      onChange={() => setChoice(scope)}
                    />
                    <span>{pagePermissionLabel(scope, request)}</span>
                  </label>
                ))}
            </div>
          </details>
        </fieldset>
        <p className="text-sm" aria-live="polite">
          {policyDescription}
        </p>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => onDecision('deny')}>Deny</AlertDialogCancel>
          <AlertDialogAction onClick={() => onDecision(choice)}>
            {pagePermissionLabel(choice, request)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** Inspect or revoke remembered rules without granting new authority from a page-authored screen. */
export function DocumentPagePermissionSettings({
  open,
  onOpenChange,
  pageName,
  grants,
  onRemove,
  onReset,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  pageName: string
  grants: PagePermissionGrant[]
  onRemove: (index: number) => void
  onReset: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-screen overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Page permissions</DialogTitle>
          <DialogDescription>
            {pageName} · Rules apply to this page and future updates, for your selected account on this device.
          </DialogDescription>
        </DialogHeader>
        {(['read', 'sign', 'publish'] as const).map((kind) => (
          <section key={kind} className="border-border flex flex-col gap-3 border-t pt-4">
            <h3 className="text-sm font-semibold">
              {kind === 'read' ? 'Reading' : kind === 'sign' ? 'Signing' : 'Publishing'}
            </h3>
            {kind === 'read' && <p className="text-sm">Reading this page’s own space is allowed by default.</p>}
            {!grants.some((grant) => grant.kind === kind) && (
              <p className="text-muted-foreground text-sm">
                {kind === 'read' ? 'Ask for other reads' : 'Ask every time'}
              </p>
            )}
            {grants.map(
              (grant, index) =>
                grant.kind === kind && (
                  <div key={index} className="flex items-start justify-between gap-4 text-sm">
                    <div className="flex min-w-0 flex-col gap-2">
                      <span>{pagePermissionLabel(grant.scope, {kind, type: grant.type || ''})}</span>
                      <PermissionTarget site={grant.site} resource={grant.resource} />
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => onRemove(index)}>
                      Revoke
                    </Button>
                  </div>
                ),
            )}
          </section>
        ))}
        <p className="text-muted-foreground text-xs">
          Revoking stops future requests. Data already shared, signatures and published changes cannot be recalled.
        </p>
        <Button variant="outline" onClick={onReset} disabled={!grants.length}>
          Reset additional permissions
        </Button>
      </DialogContent>
    </Dialog>
  )
}
