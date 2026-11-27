import type {HMDocument, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import type {
  AgentTriggerInfo,
  AppRunInfo,
  AppToolCallInfo,
  AppToolTestInfo,
  TriggerFiringInfo,
} from '@seed-hypermedia/apps-protocol'
import {useUniversalAppContext} from '@shm/shared/routing'
import {abbreviateUid} from '@shm/shared/utils/abbreviate'
import {hmId} from '@shm/shared/utils/entity-id-url'
import type {UniversalClient} from '@shm/shared/universal-client'
import {useAccount, useResource} from '@shm/shared/models/entity'
import {useNavigate} from '@shm/shared/utils/navigation'
import {useStream} from '@shm/shared/use-stream'
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'
import {ChevronRight, Download, Play} from 'lucide-react'
import {useEffect, useMemo, useState, type ReactNode} from 'react'
import {getAgentServerHealth, sendAgentAction} from '../agents/client'
import {useOwnAppServerUrl} from '../agents/server-picker'
import {Button} from '../button'
import {HMIcon} from '../hm-icon'
import {SchemaDataEditor, seedValue} from '../schema/data-editor'
import {validate, type HypermediaSchema} from '../schema/engine'
import {base64Size, fileNameOf, formatBytes, hasEmptyFile, splitFiles} from '../schema/file-value'
import {useResolvedSchema} from '../schema/schema-resolve'
import {SizableText} from '../text'
import {toast} from '../toast'
import {cn} from '../utils'

/** One field of an HM struct schema, as the config and input forms render it. */
export type StructField = {name: string; kind: string; required: boolean; description?: string}

/** The fields of an HM struct schema, in declaration order. Anything that is not a struct has none. */
export function structFields(schema: HypermediaSchema | undefined): StructField[] {
  const properties = (
    schema as {properties?: Record<string, {value?: {type?: string}; required?: boolean; description?: string}>}
  )?.properties
  if (!properties) return []
  return Object.entries(properties).map(([name, entry]) => ({
    name,
    kind: (entry.value?.type ?? '').replace('hm://hyper.media/', ''),
    required: !!entry.required,
    ...(entry.description ? {description: entry.description} : {}),
  }))
}

/** Turns form text into the value a field's kind expects (numbers and booleans parse; JSON for the rest). */
/** Field kinds typed as plain text. */
const TEXT_KINDS: Record<string, string | undefined> = {
  string: undefined,
  url: 'https://…',
  'hm-url': 'hm://…',
  'ipfs-url': 'ipfs://…',
  date: 'YYYY-MM-DD',
  'date-time': 'YYYY-MM-DDTHH:MM',
}

function fieldValue(field: StructField, text: string): unknown {
  if (field.kind in TEXT_KINDS) return text
  if (field.kind === 'integer' || field.kind === 'number' || field.kind === 'float') return Number(text)
  if (field.kind === 'boolean') return text === 'true'
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/** Form text for each field, turned into a struct value; empty optional fields are left out. */
export function structValue(fields: StructField[], values: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const field of fields) {
    const text = values[field.name]
    if (text === undefined || text === '') continue
    out[field.name] = fieldValue(field, text)
  }
  return out
}

/**
 * The server an app runs on: the app's own `appEnvironmentUrl`, else the app environment the space's
 * site advertises (its home document's `siteUrl`, whose `/hm/api/config` names it).
 *
 * `standalone` is for a tool in no app or agent. Such a tool names no server: it runs on the
 * viewer's own app environment (see {@link useOwnAppServerUrl}).
 */
export function useAppServerUrl(appId: UnpackedHypermediaId, app: HMDocument, standalone = false) {
  const named = standalone ? '' : hostServerUrl(app)
  const site = useSpaceAppServerUrl(named || standalone ? null : appId.uid)
  const own = useOwnAppServerUrl()
  if (standalone) return {serverUrl: own.serverUrl, fromApp: false, isLoading: own.isLoading}
  return {
    serverUrl: named || site.serverUrl,
    fromApp: !!named,
    isLoading: !named && site.isLoading,
  }
}

/**
 * The app environment a space's own site advertises (its home document's `siteUrl`, whose
 * `/hm/api/config` names it), or '' when the space has no site or the site names none. A null
 * `spaceUid` asks nothing.
 */
export function useSpaceAppServerUrl(spaceUid: string | null) {
  const home = useResource(spaceUid ? hmId(spaceUid) : null)
  const siteUrl =
    home.data?.type === 'document' && typeof home.data.document.metadata.siteUrl === 'string'
      ? home.data.document.metadata.siteUrl
      : ''
  const site = useQuery({
    queryKey: ['app-site-environment', siteUrl],
    enabled: !!spaceUid && !!siteUrl,
    ...APP_SERVER_QUERY,
    staleTime: 60_000,
    queryFn: () => siteAppEnvironment(siteUrl),
  })
  return {
    serverUrl: site.data || '',
    siteUrl,
    isLoading: !!spaceUid && (home.isInitialLoading || site.isInitialLoading),
  }
}

/**
 * The server a tool host names itself: an app's `appEnvironmentUrl`, or an agent's `agentServerUrl`
 * (apps and agents host tools the same way), or '' when it names none.
 */
function hostServerUrl(host: HMDocument): string {
  const {appEnvironmentUrl, agentServerUrl} = host.metadata as {appEnvironmentUrl?: unknown; agentServerUrl?: unknown}
  if (typeof appEnvironmentUrl === 'string' && appEnvironmentUrl) return appEnvironmentUrl
  if (typeof agentServerUrl === 'string' && agentServerUrl) return agentServerUrl
  return ''
}

/** The app environment a site advertises in its `/hm/api/config`, or '' when it names none. */
async function siteAppEnvironment(siteUrl: string): Promise<string> {
  const response = await fetch(`${siteUrl.replace(/\/$/, '')}/hm/api/config`)
  if (!response.ok) return ''
  const config = (await response.json()) as {appEnvironmentUrl?: string; agentServerUrl?: string}
  return config.appEnvironmentUrl || config.agentServerUrl || ''
}

/** {@link useAppServerUrl} outside React: the app's own server, else the one its space's site advertises. */
export async function resolveAppServerUrl(
  client: Pick<UniversalClient, 'request'>,
  appId: UnpackedHypermediaId,
  app: HMDocument,
): Promise<string> {
  const own = hostServerUrl(app)
  if (own) return own
  const home = await client.request('Resource', hmId(appId.uid)).catch(() => null)
  const siteUrl =
    home?.type === 'document' && typeof home.document.metadata.siteUrl === 'string'
      ? home.document.metadata.siteUrl
      : ''
  return siteUrl ? siteAppEnvironment(siteUrl).catch(() => '') : ''
}

/** Runs a tool of a running app, signed as `accountUid`; the run names that account. */
export async function callAppToolAs(
  serverUrl: string,
  accountUid: string,
  action: {appId: string; toolId: string; input: unknown},
): Promise<AppToolCallInfo> {
  return (await appAction<{call: AppToolCallInfo}>(serverUrl, accountUid, {_: 'CallAppTool', ...action})).call
}

/** App-server queries handle their own errors (a status line, not the app's error page) and refresh. */
const APP_SERVER_QUERY = {
  useErrorBoundary: false,
  meta: {handlesErrorLocally: true},
  retry: false,
  staleTime: 5_000,
} as const

/** Errors from app servers, in words: an older server does not know the run actions at all. */
export function appServerErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/Unsupported action/i.test(message)) return 'This app server does not run apps yet'
  if (/fetch failed|Failed to fetch|NetworkError|ECONNREFUSED/i.test(message)) return 'Not reachable'
  return message
}

function useAccountUid() {
  const {selectedIdentity} = useUniversalAppContext()
  return useStream(selectedIdentity) ?? null
}

async function appAction<T>(serverUrl: string, accountUid: string | null, action: Record<string, unknown>) {
  if (!accountUid) throw new Error('Select an account first')
  const response = (await sendAgentAction({serverUrl, accountUid, action: action as never})) as unknown as T
  return response
}

/**
 * Whether the server is still starting its first sandbox (see `sandboxWarmUp` in its health). The
 * desktop app's own server does that once when it starts, and a tool run in the meantime waits for
 * it. Asked again every two seconds while it lasts, and not at all afterwards.
 */
export function useSandboxWarming(serverUrl: string): boolean {
  const warmUp = useQuery({
    queryKey: ['app-sandbox-warm-up', serverUrl],
    enabled: !!serverUrl,
    ...APP_SERVER_QUERY,
    refetchInterval: (state: string | undefined) => (state === 'warming' ? 2_000 : false),
    queryFn: async () => (await getAgentServerHealth(serverUrl)).sandboxWarmUp?.state ?? 'off',
  })
  return warmUp.data === 'warming'
}

/** Whole seconds since `active` became true, counted while it stays true; 0 otherwise. */
export function useElapsedSeconds(active: boolean): number {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!active) return
    setSeconds(0)
    const startedAt = Date.now()
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => clearInterval(timer)
  }, [active])
  return active ? seconds : 0
}

/** After this long, a run that is still going says why it may be slow. */
const SLOW_RUN_SECS = 4

/**
 * What a run in progress says under the Run button. A run is usually over in a couple of seconds.
 * The exception is the first one after the app environment starts, which waits for the sandbox:
 * that takes up to a minute, and a wait that long with no word looks broken.
 */
export function runProgressText(seconds: number, warming: boolean): string | null {
  if (warming)
    return `Preparing the sandbox (${seconds}s). This happens once after the app environment starts and can take up to a minute.`
  if (seconds < SLOW_RUN_SECS) return null
  return `Still running (${seconds}s). The first run after the app environment starts also starts the sandbox, which can take up to a minute. Later runs take a couple of seconds.`
}

/** One recorded run of a tool, from the app's server. */
export function useAppToolCall(serverUrl: string, callId: string | undefined) {
  const accountUid = useAccountUid()
  return useQuery({
    queryKey: ['app-tool-call', serverUrl, callId],
    enabled: !!serverUrl && !!callId && !!accountUid,
    ...APP_SERVER_QUERY,
    staleTime: Infinity,
    queryFn: async () =>
      (await appAction<{call: AppToolCallInfo}>(serverUrl, accountUid, {_: 'GetAppToolCall', callId})).call,
  })
}

/** A host's triggers as its server holds them (see `ListHostTriggers`), with their recent firings. */
export type HostTriggersInfo = {
  hostId: string
  active: boolean
  triggers: {trigger: AgentTriggerInfo; webhookSecret?: string; firings: TriggerFiringInfo[]}[]
  errors: {documentId: string; error: string}[]
}

/** The triggers of an app or agent on the server that runs it; asking also syncs them there. */
export function useHostTriggers(serverUrl: string, hostId: string) {
  const accountUid = useAccountUid()
  return useQuery({
    queryKey: ['host-triggers', serverUrl, hostId],
    enabled: !!serverUrl && !!accountUid,
    ...APP_SERVER_QUERY,
    refetchInterval: 15_000,
    queryFn: () => appAction<HostTriggersInfo>(serverUrl, accountUid, {_: 'ListHostTriggers', hostId}),
  })
}

/** Fires a schedule trigger once, now (RunTriggerNow), and refreshes its host's firings. */
export function useRunTriggerNow(serverUrl: string) {
  const accountUid = useAccountUid()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (triggerId: string) =>
      appAction<{firing: {id: string; sessionId?: string; runId?: string}}>(serverUrl, accountUid, {
        _: 'RunTriggerNow',
        triggerId,
      }),
    onSuccess: () => void queryClient.invalidateQueries({queryKey: ['host-triggers']}),
  })
}

/** Whether the app runs on `serverUrl`, and the actions to run, stop and update it. */
export function useAppRun(serverUrl: string, appId: string) {
  const accountUid = useAccountUid()
  const queryClient = useQueryClient()
  const key = ['app-run', serverUrl, appId]
  const status = useQuery({
    queryKey: key,
    enabled: !!serverUrl && !!accountUid,
    ...APP_SERVER_QUERY,
    queryFn: async () =>
      (await appAction<{run: AppRunInfo | null}>(serverUrl, accountUid, {_: 'GetAppRun', appId})).run,
  })
  const refresh = () => queryClient.invalidateQueries({queryKey: ['app-run']})
  const run = useMutation({
    mutationFn: (input: {serverUrl: string; privateConfig?: Record<string, unknown>}) =>
      appAction(input.serverUrl, accountUid, {_: 'RunApp', appId, privateConfig: input.privateConfig}),
    onSuccess: refresh,
  })
  const stop = useMutation({
    mutationFn: () => appAction(serverUrl, accountUid, {_: 'StopApp', appId}),
    onSuccess: refresh,
  })
  return {status, run, stop, accountUid}
}

/** What a server said when asked whether it would run an app for the signed-in account. */
export type AppServerCheck = {allowed: boolean; reason?: string; run: AppRunInfo | null}

/**
 * Asks `serverUrl` whether it would run the app for `accountUid` (`CheckAppRun`), without running
 * it. A server from before that question existed is asked whether the app runs instead: if it
 * knows apps at all it is taken as willing (its `RunApp` still has the last word), and if it does
 * not, that is the answer. Throws only when the server cannot be reached.
 */
export async function checkAppServer(serverUrl: string, accountUid: string, appId: string): Promise<AppServerCheck> {
  const unsupported = (error: unknown) => /Unsupported action/i.test(error instanceof Error ? error.message : '')
  try {
    const {allowed, reason, run} = await appAction<AppServerCheck>(serverUrl, accountUid, {_: 'CheckAppRun', appId})
    return {allowed, run, ...(reason ? {reason} : {})}
  } catch (error) {
    if (!unsupported(error)) throw error
  }
  try {
    const {run} = await appAction<{run: AppRunInfo | null}>(serverUrl, accountUid, {_: 'GetAppRun', appId})
    return {allowed: true, run}
  } catch (error) {
    if (!unsupported(error)) throw error
    return {allowed: false, reason: 'This server does not run apps yet', run: null}
  }
}

/** {@link checkAppServer} as a query, for the signed-in account; idle without a server or an account. */
export function useAppServerCheck(serverUrl: string, appId: string) {
  const accountUid = useAccountUid()
  return useQuery({
    queryKey: ['app-server-check', serverUrl, appId, accountUid],
    enabled: !!serverUrl && !!accountUid,
    ...APP_SERVER_QUERY,
    staleTime: 30_000,
    queryFn: () => checkAppServer(serverUrl, accountUid!, appId),
  })
}

/** "Running on <server>" / "Not running" / "Not reachable". */
export function AppRunStatus({
  serverUrl,
  run,
  loading,
  error,
}: {
  serverUrl: string
  run: AppRunInfo | null | undefined
  loading?: boolean
  error?: unknown
}) {
  const host = (() => {
    try {
      return new URL(serverUrl).host
    } catch {
      return serverUrl
    }
  })()
  const text = loading
    ? 'Checking…'
    : !serverUrl
      ? 'No app server set'
      : error
        ? `${appServerErrorMessage(error)} (${host})`
        : run
          ? `Running on ${host}`
          : 'Not running'
  return (
    <SizableText
      size="sm"
      color={run ? undefined : 'muted'}
      className={run ? 'text-green-700 dark:text-green-400' : ''}
    >
      {text}
    </SizableText>
  )
}

/** What a run gave, whether it was a recorded call or a test run. */
type RunOutcome = Pick<AppToolCallInfo, 'error' | 'output' | 'durationMs'>

/**
 * Trying a tool: one card with whether its host runs, the input form and Run, the latest result,
 * and the calls made so far (anyone's), each of which can fill the form again.
 *
 * There is one Run button, and it runs what the page shows. For someone who can write the tool
 * (`draft` is given) that is the code on screen, whatever it is: unpublished changes, the latest
 * version, or an earlier one opened from the tool's history. The page makes no difference between
 * them, and the run is theirs: it is not added to the tool's calls.
 *
 * Anyone else can only call a tool that an app or an agent runs. That is a call like any other
 * caller's, of the published code, and the server records it. The list under the form shows those
 * calls: what apps, agents, pages and other callers ran.
 */
export function ToolRunSection({
  appId,
  app,
  toolId,
  inputSchemaRef,
  outputSchemaRef,
  standalone = false,
  draft,
  onOpenSettings,
  missingConfig,
  onSetConfig,
}: {
  /** The tool's host: the app or agent that lists it, or the tool itself when it stands on its own. */
  appId: UnpackedHypermediaId
  app: HMDocument | null
  toolId: UnpackedHypermediaId
  inputSchemaRef: string | undefined
  /** What a test run's output is checked against, here: the server does not hold a draft's schemas. */
  outputSchemaRef?: string
  /** Whether the tool is in no app or agent: it is then its author's to run, and nobody else's. */
  standalone?: boolean
  /**
   * For someone who can write the tool: the code the page shows (undefined while it loads). It is
   * what Run runs, published or not.
   */
  draft?: {source: string | undefined}
  /** Opens the app's settings, where the app is run. */
  onOpenSettings?: () => void
  /**
   * The required config the tool's host has not set, by field name. The tool cannot work without
   * it, so Run is held back and the fields are named, instead of a run that fails inside the tool.
   */
  missingConfig?: string[]
  /** Takes the person to where that config is set, when they can set it. */
  onSetConfig?: () => void
}) {
  const accountUid = useAccountUid()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const server = useAppServerUrl(appId, app ?? ({metadata: {}} as HMDocument), standalone)
  const {status} = useAppRun(server.serverUrl, appId.id)
  const schema = useResolvedSchema(inputSchemaRef)
  const outputSchema = useResolvedSchema(outputSchemaRef)
  const fields = structFields(schema.schema)
  // The form is the tool's whole input schema, drawn field by field (lists and objects included).
  const [edited, setEdited] = useState<unknown>(undefined)
  const seeded = useMemo(
    () => (schema.schema ? seedValue(schema.schema, schema.registry) : {}),
    [schema.schema, schema.registry],
  )
  const value = edited ?? seeded
  const [latest, setLatest] = useState<AppToolCallInfo | null>(null)
  const [tested, setTested] = useState<AppToolTestInfo | null>(null)
  const calls = useQuery({
    queryKey: ['app-tool-calls', server.serverUrl, toolId.id],
    enabled: !!server.serverUrl && !!accountUid,
    ...APP_SERVER_QUERY,
    queryFn: async () =>
      (
        await appAction<{calls: AppToolCallInfo[]}>(server.serverUrl, accountUid, {
          _: 'ListAppToolCalls',
          toolId: toolId.id,
        })
      ).calls,
  })
  const call = useMutation({
    mutationFn: async (input: Record<string, unknown>) =>
      (
        await appAction<{call: AppToolCallInfo}>(server.serverUrl, accountUid, {
          _: 'CallAppTool',
          appId: appId.id,
          toolId: toolId.id,
          input,
        })
      ).call,
    onSuccess: (result) => {
      setLatest(result)
      void queryClient.invalidateQueries({queryKey: ['app-tool-calls']})
    },
    onError: (error) => toast.error(appServerErrorMessage(error)),
  })
  const test = useMutation({
    mutationFn: async (input: Record<string, unknown>) =>
      (
        await appAction<{test: AppToolTestInfo}>(server.serverUrl, accountUid, {
          _: 'TestAppTool',
          appId: appId.id,
          toolId: toolId.id,
          source: draft?.source ?? '',
          // The config as the page shows it: for a tool on its own, that includes unpublished changes.
          publicConfig: (app?.metadata as {publicConfig?: unknown} | undefined)?.publicConfig ?? {},
          input,
        })
      ).test,
    onSuccess: setTested,
    onError: (error) => toast.error(appServerErrorMessage(error)),
  })
  const running = !!status.data
  const checking = server.isLoading || status.isInitialLoading
  // Someone who can write the tool runs the code on screen (`test`), whatever state it is in.
  // Anyone else calls the published tool through its host (`run`), when the host runs.
  const mode: 'run' | 'test' | null = draft
    ? server.serverUrl && !server.isLoading
      ? 'test'
      : null
    : !standalone && running
      ? 'run'
      : null
  const busy = call.isLoading || test.isLoading
  const warming = useSandboxWarming(server.serverUrl)
  const elapsed = useElapsedSeconds(busy)
  const progress = busy ? runProgressText(elapsed, warming) : null
  const entered = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const missing = fields.filter((field) => field.required && (entered[field.name] ?? '') === '')
  // Problems are named only for what has been filled in; an empty required field just holds Run back.
  const errors =
    schema.schema && fields.length && !missing.length
      ? validate(schema.schema, value, 'input', {}, schema.registry)
      : []
  // A file field is a value from the start, so it is checked apart: Run waits for a file to be picked.
  const configMissing = missingConfig ?? []
  const canRun =
    !busy &&
    configMissing.length === 0 &&
    missing.length === 0 &&
    errors.length === 0 &&
    !hasEmptyFile(value) &&
    (mode !== 'test' || !!draft?.source?.trim())
  const openCall = (callId: string) => navigate({key: 'document', id: toolId, toolCallId: callId})
  // A test run's output is checked here against the output schema the editor holds.
  const outputProblems =
    mode === 'test' && tested && !tested.error && outputSchema.schema
      ? validate(outputSchema.schema, tested.output, 'output', {}, outputSchema.registry)
      : []

  // shrink-0 throughout: this sits in a scrolling flex column (the desktop's fixed-height page),
  // which would otherwise squash it to a line.
  return (
    <section className="flex shrink-0 flex-col gap-2" data-testid="tool-run">
      <SizableText size="sm" weight="bold">
        Run
      </SizableText>
      {mode ? (
        <form
          className="flex shrink-0 flex-col gap-4 rounded-lg border p-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (!canRun) return
            const input = fields.length ? entered : {}
            if (mode === 'test') test.mutate(input)
            else call.mutate(input)
          }}
        >
          {fields.length ? (
            <fieldset disabled={busy} className="min-w-0" data-testid="tool-input">
              <SchemaDataEditor
                schema={schema.schema!}
                registry={schema.registry}
                value={value}
                onValue={setEdited}
                plainOptional
              />
            </fieldset>
          ) : (
            <SizableText size="sm" color="muted">
              This tool takes no input.
            </SizableText>
          )}
          {errors.length ? (
            <ul role="alert" className="text-destructive list-disc pl-4 text-xs">
              {errors.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          ) : null}
          {configMissing.length ? (
            <div
              role="alert"
              className="text-destructive flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"
              data-testid="tool-run-missing-config"
            >
              <span>This tool cannot run yet. Required config is not set: {configMissing.join(', ')}.</span>
              {onSetConfig ? (
                <Button type="button" size="sm" variant="outline" onClick={onSetConfig}>
                  Set it
                </Button>
              ) : null}
            </div>
          ) : null}
          <div className="flex items-center justify-end gap-3">
            <Button type="submit" variant="default" disabled={!canRun}>
              <Play className="size-4" /> {busy ? (elapsed ? `Running… ${elapsed}s` : 'Running…') : 'Run'}
            </Button>
          </div>
          {progress ? (
            <SizableText size="xs" color="muted" role="status" data-testid="tool-run-progress">
              {progress}
            </SizableText>
          ) : !busy && warming ? (
            <SizableText size="xs" color="muted" role="status" data-testid="tool-run-progress">
              The sandbox is being prepared. A run started now waits for it, for up to a minute.
            </SizableText>
          ) : null}
          {mode === 'test' && tested ? (
            <TestResult test={tested} problems={outputProblems} />
          ) : mode === 'run' && latest ? (
            <CallResult call={latest} onOpen={() => openCall(latest.id)} />
          ) : null}
        </form>
      ) : standalone ? (
        server.isLoading ? null : (
          <SizableText size="sm" color="muted">
            {draft
              ? 'You have no app environment to run this tool on.'
              : 'This tool is in no app or agent, so only people who can edit it can run it here. Add it to an app or an agent to use it.'}
          </SizableText>
        )
      ) : checking ? null : (
        <SizableText size="sm" color="muted">
          {status.isError
            ? `${appServerErrorMessage(status.error)}. `
            : !server.serverUrl
              ? 'This app does not name the server that runs it, so its runs cannot be shown here. '
              : 'This app is not running. '}
          {onOpenSettings ? (
            <button type="button" className="text-foreground underline underline-offset-2" onClick={onOpenSettings}>
              Run it from the app’s settings
            </button>
          ) : null}
        </SizableText>
      )}
      {calls.data?.length ? (
        <div className="mt-2 flex shrink-0 flex-col">
          <SizableText size="sm" weight="bold">
            Calls
          </SizableText>
          <SizableText size="xs" color="muted" className="mb-1">
            What apps, agents and other callers ran. Each is kept with its input and its result.
          </SizableText>
          <div className="flex flex-col rounded-lg border">
            {calls.data.map((item) => (
              <CallRow key={item.id} call={item} onOpen={() => openCall(item.id)} />
            ))}
          </div>
        </div>
      ) : null}
    </section>
  )
}

/** What a run of the code on screen gave: its output or error, what the code printed, and where the output breaks its schema. */
function TestResult({test, problems}: {test: AppToolTestInfo; problems: string[]}) {
  return (
    <div className="flex flex-col gap-1.5 border-t pt-4" aria-live="polite" data-testid="tool-test-result">
      <CallOutcome call={test} />
      <CallOutput call={test} />
      {problems.length ? (
        <div role="alert" className="text-destructive flex flex-col gap-1 text-xs">
          <span>The output does not match the output schema:</span>
          <ul className="list-disc pl-4">
            {problems.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {test.logs ? (
        <>
          <SizableText size="xs" color="muted">
            Printed
          </SizableText>
          <pre className="bg-background max-h-48 overflow-auto rounded-md border p-2 font-mono text-xs whitespace-pre-wrap">
            {test.logs}
          </pre>
        </>
      ) : null}
    </div>
  )
}

export function Json({value}: {value: unknown}) {
  return (
    <pre className="bg-background max-h-64 overflow-auto rounded-md border p-2 font-mono text-xs break-words whitespace-pre-wrap">
      {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
    </pre>
  )
}

export function CallOutcome({call}: {call: RunOutcome}) {
  return (
    <span className="flex items-center gap-2 text-xs">
      <span className={cn('font-medium', call.error ? 'text-destructive' : 'text-green-700 dark:text-green-400')}>
        {call.error ? 'Failed' : 'Succeeded'}
      </span>
      <span className="text-muted-foreground">{formatDuration(call.durationMs ?? 0)}</span>
    </span>
  )
}

/** The latest call's result, right under the form, with a way into its page. */
function CallResult({call, onOpen}: {call: AppToolCallInfo; onOpen?: () => void}) {
  return (
    <div className="flex flex-col gap-1.5 border-t pt-4" aria-live="polite">
      <div className="flex items-center justify-between gap-2">
        <CallOutcome call={call} />
        {onOpen ? (
          <Button type="button" size="sm" variant="ghost" onClick={onOpen}>
            Open run <ChevronRight className="size-4" />
          </Button>
        ) : null}
      </div>
      <CallOutput call={call} />
    </div>
  )
}

/**
 * A run's output, or its error. Files in the output are shown by name, type and size instead of
 * their bytes, and each one can be saved: a tool stores nothing, so this is where its files go.
 */
export function CallOutput({call}: {call: RunOutcome}) {
  const {shown, files} = useMemo(() => splitFiles(call.output), [call.output])
  if (call.error)
    return (
      <pre className="text-destructive bg-background max-h-96 overflow-auto rounded-md border p-2 font-mono text-xs whitespace-pre-wrap">
        {call.error}
      </pre>
    )
  return (
    <div className="flex flex-col gap-2">
      <Json value={shown} />
      {files.length ? (
        <ul className="flex flex-col rounded-md border" aria-label="Files this run returned">
          {files.map((file, index) => (
            <FileRow key={`${index}:${file.name}`} file={file} />
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/** One returned file, with a link that saves it. The link's address lives as long as the row. */
function FileRow({file}: {file: {name: string; mimeType: string; data: string}}) {
  const [href, setHref] = useState<string>()
  useEffect(() => {
    const bytes = Uint8Array.from(atob(file.data), (char) => char.charCodeAt(0))
    const url = URL.createObjectURL(new Blob([bytes], {type: file.mimeType}))
    setHref(url)
    return () => URL.revokeObjectURL(url)
  }, [file])
  return (
    <li className="flex items-center gap-3 border-b px-3 py-1.5 text-sm last:border-b-0">
      <span className="min-w-0 flex-1 truncate">{file.name}</span>
      <span className="text-muted-foreground shrink-0 text-xs">
        {file.mimeType} · {formatBytes(base64Size(file.data))}
      </span>
      <a
        className="text-foreground flex shrink-0 items-center gap-1 text-xs underline underline-offset-2"
        href={href}
        download={file.name.split('/').pop()}
        aria-label={`Save ${file.name}`}
      >
        <Download className="size-3.5" /> Save
      </a>
    </li>
  )
}

/** A past run: its input, who triggered it, when. Opens the run's page. */
function CallRow({call, onOpen}: {call: AppToolCallInfo; onOpen: () => void}): ReactNode {
  return (
    <button
      type="button"
      className="hover:bg-muted/60 flex w-full items-center gap-3 border-b px-3 py-2 text-left text-sm last:border-b-0"
      onClick={onOpen}
    >
      <span className={cn('size-1.5 shrink-0 rounded-full', call.error ? 'bg-destructive' : 'bg-green-500')} />
      <span className="min-w-0 flex-1 truncate">{inputSummary(call.input)}</span>
      <CallerName uid={call.caller} size={16} className="text-muted-foreground shrink-0 text-xs" />
      <span className="text-muted-foreground shrink-0 text-xs">{formatTime(call.createdAt)}</span>
      <ChevronRight className="text-muted-foreground size-3.5 shrink-0" />
    </button>
  )
}

/** The account that triggered a run: its avatar and name. */
export function CallerName({uid, size = 20, className}: {uid: string; size?: number; className?: string}) {
  const valid = /^z[1-9A-HJ-NP-Za-km-z]{20,}$/.test(uid)
  const account = useAccount(valid ? uid : null)
  const metadata = account.data?.metadata
  if (!valid) return <span className={className}>{uid}</span>
  return (
    <span className={cn('flex min-w-0 items-center gap-1.5', className)}>
      <HMIcon id={hmId(uid)} name={metadata?.name} icon={metadata?.icon} size={size} />
      <span className="truncate">{metadata?.name || abbreviateUid(uid)}</span>
    </span>
  )
}

/** A call's input in one line: `city: Lisbon, days: 3`. */
export function inputSummary(input: unknown): string {
  if (!input || typeof input !== 'object') return input === undefined ? '(no input)' : JSON.stringify(input)
  const entries = Object.entries(input as Record<string, unknown>)
  if (!entries.length) return '(no input)'
  return entries
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : fileNameOf(value) ?? JSON.stringify(value)}`)
    .join(', ')
}

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

export function formatTime(at: number): string {
  const date = new Date(at)
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'})
    : date.toLocaleDateString([], {month: 'short', day: 'numeric'})
}
