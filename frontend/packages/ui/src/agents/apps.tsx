/**
 * The Apps dialog: the apps mounted for the selected account on one agents server, and the apps it
 * could mount. A server-wide mount is provided by the server (the Datalab converter on the hosted
 * one, with its usage on the shared key); the account's own mounts are pages it published in its
 * space, each with the arguments the app declares. Secret arguments are stored here, on the
 * server, never in a page. Mounting is publishing, and it is consent: the catalog says what the
 * app's code gets (the secrets, the hosts, the agent's memory, the server it runs on), and where
 * the platform can start a typed draft the Mount button opens the mount page pre-filled with the
 * app's address and version, and the person publishes it; elsewhere it leads to the app's
 * page. The catalog of apps is also what the agent's Tools tab shows under its rows, so apps
 * are found where their tools are missed.
 */
import {useTypedDocumentSearch} from '@shm/shared/models/typed-documents'
import {Button} from '@shm/ui/button'
import {DialogDescription, DialogTitle} from '@shm/ui/components/dialog'
import {Input} from '@shm/ui/components/input'
import {Notice} from '@shm/ui/notice'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {ExternalLink, KeyRound, Package, Plus, RefreshCw} from 'lucide-react'
import React, {useState} from 'react'
import type {AppArgumentInfo, AppMountInfo, SpaceBinding} from './client'
import {useAppUsage, useApps, useRefreshApps, useSaveAppSecret} from './models'
import {useOpenUrl} from './navigation'
import {getAgentsPlatform} from './platform'

/** The app type, spelled the way the schema library names it; the bundled registry resolves it. */
export const APP_TYPE = 'hm://hyper.media/agent/app'
/** The app mount type, the page a space publishes to install an app. */
export const APP_MOUNT_TYPE = 'hm://hyper.media/agent/app-mount'

const CHIP_CLASS = 'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase'

/**
 * What to tell the person when mounts published in the space are not this server's: the space
 * names another server, or none at all. Null when the space is bound to this server.
 */
export function bindingNotice(binding: SpaceBinding | undefined): {title: string; body: string} | null {
  if (!binding || binding.isThisServer) return null
  if (binding.source === 'none' || !binding.agentServerUrl) {
    return {
      title: 'This space names no agents server yet',
      body: 'Neither its home document nor its site names one, so a mount published in it belongs to no server. Choose this server in the space’s settings, under Agents, then mount.',
    }
  }
  return {
    title: 'This space is bound to another agents server',
    body: `Its ${binding.source === 'home' ? 'home document' : 'site'} names ${
      binding.agentServerUrl
    }, so mounts published in it are that server’s. Choose this server in the space’s settings, under Agents, to mount apps here.`,
  }
}

/** An app this node knows, with the account's mount of it when one exists. */
export type AppCatalogEntry = {
  /** The app page's address, what a mount's `app` names. */
  url: string
  /** The app page's current version, which a new mount pins: the code consented to is the code that runs. */
  version?: string
  name: string
  summary: string
  /** What the app declares its code gets, for the person to see before mounting. */
  needs: AppNeeds
  mount?: AppMountInfo
}

/** What an app's code receives once mounted, read from its page's attributes. */
export type AppNeeds = {
  /** The arguments a mount takes, secret ones first; a choice argument lists the values it accepts. */
  arguments: {name: string; secret: boolean; required: boolean; choices?: string[]}[]
  /** The hosts the code may reach; none means it runs without network. */
  hosts: string[]
}

/** Reads what an app page's attributes declare its code gets. */
export function appNeedsOf(metadata: Record<string, unknown>): AppNeeds {
  const declared = metadata.arguments
  const network = metadata.network
  const arguments_ = Object.entries(
    declared && typeof declared === 'object' ? (declared as Record<string, unknown>) : {},
  )
    .map(([name, raw]) => {
      const decl = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
      const choices = decl.choices && typeof decl.choices === 'object' ? Object.keys(decl.choices) : []
      return {
        name,
        secret: decl.secret === true,
        required: decl.required === true,
        ...(choices.length ? {choices} : {}),
      }
    })
    .sort((a, b) => Number(b.secret) - Number(a.secret))
  const hosts = Object.values(
    network && typeof network === 'object' ? (network as Record<string, unknown>) : {},
  ).filter((host): host is string => typeof host === 'string')
  return {arguments: arguments_, hosts}
}

/** One line on what mounting an app hands its code, shown before the person publishes the mount. */
export function appConsentLine(needs: AppNeeds, serverUrl: string | undefined): string {
  const secrets = needs.arguments.filter((arg) => arg.secret).map((arg) => arg.name)
  const parts = [
    secrets.length ? `your ${secrets.join(', ')}` : 'no secret of yours',
    needs.hosts.length ? `network access to ${needs.hosts.join(', ')}` : 'no network access',
    'read and write access to the memory of the agent that calls it',
  ]
  return `Its code runs on ${serverUrl ?? 'this agents server'} with ${parts.join(', ')}.`
}

/**
 * One line on the settings a mount page may carry for an app: its non-secret arguments, each with
 * the values it accepts. Null when the app takes none. They are attributes of the mount page, not
 * fields of this dialog, so the person learns here what the page can say.
 */
export function appSettingsLine(needs: AppNeeds): string | null {
  const settings = needs.arguments.filter((arg) => !arg.secret)
  if (!settings.length) return null
  const list = settings.map((arg) => (arg.choices?.length ? `${arg.name} (${arg.choices.join(', ')})` : arg.name))
  return `Settings its mount page may carry under arguments: ${list.join(', ')}. Left unset, the app's defaults apply.`
}

/**
 * The account's mounts keyed by the page each installs, without the version a mount page pins,
 * so the catalog recognizes a mounted app whatever version its mount names.
 */
export function mountsByApp(mounts: AppMountInfo[]): Map<string, AppMountInfo> {
  return new Map(mounts.map((mount) => [mount.app.replace(/[?#].*$/, ''), mount]))
}

/** The apps this node knows, found by their type, paired with the mounts the account sees. */
export function useAppCatalog(
  serverUrl: string | undefined,
  accountUid: string | null | undefined,
): {entries: AppCatalogEntry[]; isLoading: boolean; binding?: SpaceBinding; error?: string} {
  const apps = useApps(serverUrl, accountUid)
  const pages = useTypedDocumentSearch(APP_TYPE, '', {pageSize: 24})
  const mounted = mountsByApp(apps.data?.apps ?? [])
  const entries = (pages.data ?? []).map((info): AppCatalogEntry => {
    const url = `hm://${info.id.uid}${info.path.length ? `/${info.path.join('/')}` : ''}`
    return {
      url,
      ...(info.version ? {version: info.version} : {}),
      name: info.metadata.name || info.path[info.path.length - 1] || url,
      summary: info.metadata.summary ?? '',
      needs: appNeedsOf(info.metadata as Record<string, unknown>),
      mount: mounted.get(url),
    }
  })
  return {
    entries,
    isLoading: pages.isLoading || apps.isLoading,
    ...(apps.data ? {binding: apps.data.binding} : {}),
    ...(apps.isError ? {error: apps.error instanceof Error ? apps.error.message : 'unknown error'} : {}),
  }
}

/**
 * Mounts an app: starts the mount page as a pre-filled draft in the selected account's space
 * where the platform can, else opens the app's page so the person can publish a mount by hand.
 */
export function useMountApp(onStarted?: () => void) {
  const createTyped = (getAgentsPlatform().useCreateTypedDocument ?? (() => null))()
  const openUrl = useOpenUrl()
  return {
    canDraft: !!createTyped,
    mount: async (entry: AppCatalogEntry) => {
      if (!createTyped) {
        openUrl(entry.url)
        return
      }
      try {
        // The version is pinned: what the person saw and consented to is what runs, until they
        // edit the mount page to a newer version.
        await createTyped({
          schemaUrl: APP_MOUNT_TYPE,
          name: entry.name,
          metadata: {
            app: entry.version ? `${entry.url}?v=${entry.version}` : entry.url,
            scope: 'space',
            enabled: true,
          },
        })
        onStarted?.()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : `Could not start a mount of ${entry.name}`)
      }
    },
  }
}

/** The apps the account has not mounted, each with a Mount button. Renders nothing when there are none. */
export function AppCatalog({
  serverUrl,
  accountUid,
  onStarted,
}: {
  serverUrl: string | undefined
  accountUid: string | null | undefined
  onStarted?: () => void
}) {
  const catalog = useAppCatalog(serverUrl, accountUid)
  const {canDraft, mount} = useMountApp(onStarted)
  const openUrl = useOpenUrl()
  const unmounted = catalog.entries.filter((entry) => !entry.mount)
  // A server that does not offer apps (one from before them) cannot mount anything, and neither
  // can a space that is not bound to this server: the page would belong to no server.
  if (!unmounted.length || catalog.error) return null
  const mountable = catalog.binding?.isThisServer === true
  return (
    <div className="flex flex-col gap-2">
      <SizableText size="sm" weight="bold">
        Apps you can mount
      </SizableText>
      {unmounted.map((entry) => {
        const settings = appSettingsLine(entry.needs)
        return (
          <div key={entry.url} className="border-border flex items-center gap-3 rounded-lg border p-3">
            <Package className="text-muted-foreground size-5 shrink-0" />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <SizableText size="sm" weight="bold" className="truncate">
                {entry.name}
              </SizableText>
              {entry.summary ? (
                <SizableText size="xs" color="muted">
                  {entry.summary}
                </SizableText>
              ) : null}
              <SizableText size="xs" color="muted">
                {appConsentLine(entry.needs, serverUrl)}
              </SizableText>
              {settings ? (
                <SizableText size="xs" color="muted">
                  {settings}
                </SizableText>
              ) : null}
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Open the page of ${entry.name}`}
              onClick={() => openUrl(entry.url)}
            >
              <ExternalLink className="size-4" />
            </Button>
            {mountable ? (
              <Button size="sm" onClick={() => void mount(entry)}>
                <Plus className="size-4" />
                Mount
              </Button>
            ) : null}
          </div>
        )
      })}
      <SizableText size="xs" color="muted">
        {!mountable
          ? 'Nothing can be mounted until this space is bound to this server: choose it in the space’s settings, under Agents, then come back.'
          : canDraft
            ? 'Mount starts the mount page as a draft in your space with the app filled in. Publish it and the server picks it up: the app then moves up to your mounts, with a field for a secret argument such as an API key, which is stored on the server and never written into the page. Any other argument is an attribute of the mount page: set it in the draft, or edit the page later.'
            : 'Mounting is publishing a page typed App Mount in your space whose `app` names the app’s page. The app then moves up to your mounts, with a field for a secret argument such as an API key, which is stored on the server and never written into the page. Any other argument is an attribute of the mount page.'}
      </SizableText>
    </div>
  )
}

export function AppsDialog({
  input,
  onClose,
}: {
  input: {serverUrl: string; selectedAccountId: string | null | undefined}
  onClose: () => void
}) {
  const apps = useApps(input.serverUrl, input.selectedAccountId)
  const refresh = useRefreshApps(input.serverUrl, input.selectedAccountId)
  const list = apps.data?.apps ?? []
  const notice = bindingNotice(apps.data?.binding)
  // A server from before apps answers the request with an error; it offers no apps at all, and
  // the catalog below would only invite a mount nothing acts on.
  const unsupported = apps.isError ? (apps.error instanceof Error ? apps.error.message : 'unknown error') : null

  async function handleRefresh() {
    try {
      const result = await refresh.mutateAsync()
      toast.success(`${result.apps.length} app${result.apps.length === 1 ? '' : 's'} mounted`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not refresh the apps')
    }
  }

  return (
    <div className="flex flex-col gap-5 sm:min-w-[520px]">
      <div className="flex flex-col gap-3">
        <DialogTitle>Apps</DialogTitle>
        <DialogDescription>
          Your agents' built-in tools need nothing. An app adds a tool that needs something of its own, a key, a
          subscription or a service, such as the Datalab converter. An app is a page; mounting it for your space is
          publishing a page that names it, and this server reads those pages and offers the app's tools to every agent
          of the space that has them in its grants.
        </DialogDescription>
      </div>
      {unsupported ? (
        <Notice size="sm" tone="warning" title="This agents server does not offer apps">
          It answered the apps request with an error ({unsupported}). It runs a version from before apps; nothing can be
          mounted on it until it is updated.
        </Notice>
      ) : notice ? (
        <Notice size="sm" tone="warning" title={notice.title}>
          {notice.body}
        </Notice>
      ) : null}
      <div className="grid gap-3">
        {list.map((app) => (
          <AppCard
            key={`${app.scope}:${app.slug}`}
            app={app}
            serverUrl={input.serverUrl}
            accountUid={input.selectedAccountId}
          />
        ))}
        {apps.isLoading && list.length === 0 ? (
          <SizableText color="muted">Loading apps…</SizableText>
        ) : list.length === 0 && !unsupported ? (
          <SizableText color="muted">
            No app is mounted for this space on this server yet, so your agents have their built-in tools only.
          </SizableText>
        ) : null}
      </div>
      <AppCatalog serverUrl={input.serverUrl} accountUid={input.selectedAccountId} onStarted={onClose} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SizableText size="xs" color="muted">
          The server looks for new mounts every few minutes. Refresh asks it to look now.
        </SizableText>
        <Button variant="outline" onClick={() => void handleRefresh()} disabled={refresh.isLoading}>
          {refresh.isLoading ? <Spinner size="small" /> : <RefreshCw className="size-4" />}
          Refresh
        </Button>
      </div>
    </div>
  )
}

function AppCard({
  app,
  serverUrl,
  accountUid,
}: {
  app: AppMountInfo
  serverUrl: string
  accountUid: string | null | undefined
}) {
  const openUrl = useOpenUrl()
  const usage = useAppUsage(
    serverUrl,
    accountUid,
    app.scope === 'server' && app.usage?.meter === 'per-unit' ? app.slug : undefined,
  )
  const secrets = app.arguments.filter((arg) => arg.secret)
  // Non-secret arguments are attributes of the mount page; the card shows each with its value or
  // default, so a setting the person never set is still known to exist.
  const settings = app.arguments.filter((arg) => !arg.secret)
  // A space's own mount that only lacks a key it takes right here is not broken, it is unfinished.
  const missing = app.scope === 'space' ? secrets.filter((arg) => arg.required && !arg.hasValue) : []
  const missingNames = missing.map((arg) => arg.name).join(' and ')
  const toolNames = app.tools.map((tool) => tool.tool).join(', ') || 'its tools'
  return (
    <div className="border-border flex flex-col gap-3 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <Package className="text-muted-foreground mt-0.5 size-5 shrink-0" />
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <SizableText weight="bold">{app.name}</SizableText>
              <span className={`${CHIP_CLASS} bg-muted text-muted-foreground`}>
                {app.scope === 'server' ? 'Provided by this server' : 'Your mount'}
              </span>
              {missing.length ? (
                <span className={`${CHIP_CLASS} bg-warning/10 text-warning-foreground`}>Needs your {missingNames}</span>
              ) : app.status.state === 'error' ? (
                <span className={`${CHIP_CLASS} bg-destructive/10 text-destructive`}>Not working</span>
              ) : app.status.state === 'ok' ? (
                <span className={`${CHIP_CLASS} bg-muted text-muted-foreground`}>Working</span>
              ) : null}
            </div>
            <SizableText size="sm" color="muted">
              {app.summary}
            </SizableText>
            <SizableText size="xs" color="muted" className="font-mono">
              {app.tools.map((tool) => `${tool.tool} (${tool.runtime})`).join(', ') || 'no tools'}
              {app.version ? ` · version ${app.version.slice(0, 12)}` : ''}
            </SizableText>
            <SizableText size="xs" color="muted">
              {Object.values(app.network).length
                ? `Its code reaches ${Object.values(app.network).join(', ')} and the agent's memory.`
                : 'Its code runs without network, with the agent’s memory.'}
            </SizableText>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {app.mountId ? (
            <Button variant="ghost" size="icon" aria-label="Open the mount page" onClick={() => openUrl(app.mountId)}>
              <ExternalLink className="size-4" />
            </Button>
          ) : null}
        </div>
      </div>
      {missing.length ? (
        <Notice size="sm" tone="warning" title={`Add your ${missingNames} below to finish mounting`}>
          The mount page is published and this server has read it. Enter the key and press Store: it is kept on the
          server, never in the page, and the server then offers {toolNames} to your agents.
        </Notice>
      ) : app.status.state === 'error' ? (
        <Notice size="sm" tone="warning" title="This mount offers no tools">
          {app.status.error}
        </Notice>
      ) : null}
      {usage.data ? (
        <SizableText size="sm" color="muted">
          {usage.data.used} of {usage.data.allowance} {usage.data.unit} used this{' '}
          {usage.data.period.length === 7 ? 'month' : 'period'} on the shared key, {usage.data.remaining} left. Mount
          the app with your own key to lift the cap.
        </SizableText>
      ) : null}
      {settings.length ? (
        <div className="border-border/60 flex flex-col gap-1 border-t pt-3">
          {settings.map((arg) => (
            <SizableText key={arg.name} size="xs" color="muted">
              <span className="font-mono">{arg.name}</span>
              {': '}
              {arg.value !== undefined && arg.value !== null ? String(arg.value) : 'the app’s default'}
              {arg.choices ? ` · one of ${Object.keys(arg.choices).join(', ')}` : ''}
              {arg.description ? ` · ${arg.description}` : ''}
            </SizableText>
          ))}
          <SizableText size="xs" color="muted">
            {app.scope === 'space'
              ? 'These are the arguments attribute of your mount page: open the page, set a value, publish, then Refresh here.'
              : 'Set by the operator on the server-wide mount page.'}
          </SizableText>
        </div>
      ) : null}
      {app.scope === 'space' && secrets.length ? (
        <div className="border-border/60 flex flex-col gap-2 border-t pt-3">
          {secrets.map((arg) => (
            <SecretArgumentRow key={arg.name} app={app} arg={arg} serverUrl={serverUrl} accountUid={accountUid} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** One secret argument of the account's own mount: stored or not, and a field to store it. */
function SecretArgumentRow({
  app,
  arg,
  serverUrl,
  accountUid,
}: {
  app: AppMountInfo
  arg: AppArgumentInfo
  serverUrl: string
  accountUid: string | null | undefined
}) {
  const save = useSaveAppSecret(serverUrl, accountUid)
  const [value, setValue] = useState('')
  const [editing, setEditing] = useState(!arg.hasValue)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    try {
      await save.mutateAsync({slug: app.slug, arg: arg.name, value})
      setValue('')
      setEditing(false)
      toast.success(`${arg.name} stored for ${app.name}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Could not store ${arg.name}`)
    }
  }

  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={handleSubmit}>
      <KeyRound className="text-muted-foreground size-4 shrink-0" />
      <SizableText size="sm" weight="bold" className="shrink-0">
        {arg.name}
      </SizableText>
      {arg.description ? (
        <SizableText size="xs" color="muted" className="min-w-0 flex-1">
          {arg.description}
        </SizableText>
      ) : null}
      {editing ? (
        <>
          <Input
            type="password"
            className="min-w-48 flex-1"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={arg.required ? 'Required' : 'Optional'}
            autoComplete="off"
            disabled={save.isLoading}
          />
          <Button type="submit" size="sm" disabled={save.isLoading || !value.trim()}>
            {save.isLoading ? <Spinner size="small" /> : null}
            Store
          </Button>
          {arg.hasValue ? (
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={save.isLoading}>
              Cancel
            </Button>
          ) : null}
        </>
      ) : (
        <>
          <span className={`${CHIP_CLASS} bg-muted text-muted-foreground`}>Stored</span>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Replace
          </Button>
        </>
      )}
    </form>
  )
}
