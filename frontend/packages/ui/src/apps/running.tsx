import type {HMDocument, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import type {AppRunInfo, AppToolCallInfo} from '@seed-hypermedia/apps-protocol'
import {useUniversalAppContext} from '@shm/shared/routing'
import {abbreviateUid} from '@shm/shared/utils/abbreviate'
import {hmId} from '@shm/shared/utils/entity-id-url'
import type {UniversalClient} from '@shm/shared/universal-client'
import {useAccount, useResource} from '@shm/shared/models/entity'
import {useNavigate} from '@shm/shared/utils/navigation'
import {useStream} from '@shm/shared/use-stream'
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'
import {ChevronRight, Play} from 'lucide-react'
import {useState, type ReactNode} from 'react'
import {sendAgentAction} from '../agents/client'
import {Button} from '../button'
import {HMIcon} from '../hm-icon'
import {Input} from '../components/input'
import {Label} from '../components/label'
import type {HypermediaSchema} from '../schema/engine'
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
function fieldValue(field: StructField, text: string): unknown {
  if (field.kind === 'string') return text
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
 */
export function useAppServerUrl(appId: UnpackedHypermediaId, app: HMDocument) {
  const own = hostServerUrl(app)
  const home = useResource(own ? null : hmId(appId.uid))
  const siteUrl =
    home.data?.type === 'document' && typeof home.data.document.metadata.siteUrl === 'string'
      ? home.data.document.metadata.siteUrl
      : ''
  const site = useQuery({
    queryKey: ['app-site-environment', siteUrl],
    enabled: !own && !!siteUrl,
    ...APP_SERVER_QUERY,
    staleTime: 60_000,
    queryFn: () => siteAppEnvironment(siteUrl),
  })
  return {
    serverUrl: own || site.data || '',
    fromApp: !!own,
    isLoading: !own && (home.isInitialLoading || site.isInitialLoading),
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

/**
 * Trying a tool: one card with whether its app runs, the input form and Run, the latest result,
 * and the calls made so far (anyone's), each of which can fill the form again.
 */
export function ToolRunSection({
  appId,
  app,
  toolId,
  inputSchemaRef,
  onOpenSettings,
}: {
  appId: UnpackedHypermediaId
  app: HMDocument | null
  toolId: UnpackedHypermediaId
  inputSchemaRef: string | undefined
  /** Opens the app's settings, where the app is run. */
  onOpenSettings?: () => void
}) {
  const accountUid = useAccountUid()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const server = useAppServerUrl(appId, app ?? ({metadata: {}} as HMDocument))
  const {status} = useAppRun(server.serverUrl, appId.id)
  const schema = useResolvedSchema(inputSchemaRef)
  const fields = structFields(schema.schema)
  const [values, setValues] = useState<Record<string, string>>({})
  const [latest, setLatest] = useState<AppToolCallInfo | null>(null)
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
  const running = !!status.data
  const checking = server.isLoading || status.isInitialLoading
  const missing = fields.filter((field) => field.required && !values[field.name])
  const canRun = !call.isLoading && missing.length === 0
  const openCall = (callId: string) => navigate({key: 'document', id: toolId, toolCallId: callId})

  // shrink-0 throughout: this sits in a scrolling flex column (the desktop's fixed-height page),
  // which would otherwise squash it to a line.
  return (
    <section className="flex shrink-0 flex-col gap-2" data-testid="tool-run">
      <SizableText size="sm" weight="bold">
        Run
      </SizableText>
      {running ? (
        <form
          className="flex shrink-0 flex-col gap-4 rounded-lg border p-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (canRun) call.mutate(structValue(fields, values))
          }}
        >
          {fields.length ? (
            <div className="grid grid-cols-[minmax(6rem,auto)_1fr] items-center gap-x-4 gap-y-3">
              {fields.map((field) => (
                <InputField
                  key={field.name}
                  field={field}
                  value={values[field.name] ?? ''}
                  disabled={call.isLoading}
                  onChange={(text) => setValues({...values, [field.name]: text})}
                />
              ))}
            </div>
          ) : (
            <SizableText size="sm" color="muted">
              This tool takes no input.
            </SizableText>
          )}
          <div className="flex justify-end">
            <Button type="submit" variant="default" disabled={!canRun}>
              <Play className="size-4" /> {call.isLoading ? 'Running…' : 'Run'}
            </Button>
          </div>
          {latest ? <CallResult call={latest} onOpen={() => openCall(latest.id)} /> : null}
        </form>
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
          <SizableText size="sm" weight="bold" className="mb-1">
            Runs
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

/** One input of the tool's form: its name (and type) on the left, the value on the right. */
function InputField({
  field,
  value,
  disabled,
  onChange,
}: {
  field: StructField
  value: string
  disabled: boolean
  onChange: (text: string) => void
}) {
  const id = `tool-input-${field.name}`
  return (
    <>
      <Label htmlFor={id} className="flex flex-col items-start gap-0">
        <span className="font-mono text-sm">
          {field.name}
          {field.required ? <span className="text-muted-foreground"> *</span> : null}
        </span>
        <span className="text-muted-foreground text-xs font-normal">{field.description ?? field.kind}</span>
      </Label>
      {field.kind === 'boolean' ? (
        <select
          id={id}
          className="border-border bg-background h-9 rounded-md border px-2 text-sm"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">—</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : (
        <Input
          id={id}
          type={field.kind === 'integer' || field.kind === 'float' || field.kind === 'number' ? 'number' : 'text'}
          autoComplete="off"
          className="bg-background"
          placeholder={['string', 'integer', 'float', 'number'].includes(field.kind) ? undefined : 'JSON'}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </>
  )
}

export function Json({value}: {value: unknown}) {
  return (
    <pre className="bg-background max-h-64 overflow-auto rounded-md border p-2 font-mono text-xs break-words whitespace-pre-wrap">
      {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
    </pre>
  )
}

export function CallOutcome({call}: {call: AppToolCallInfo}) {
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

/** A run's output, or its error. */
export function CallOutput({call}: {call: AppToolCallInfo}) {
  return call.error ? (
    <pre className="text-destructive bg-background max-h-96 overflow-auto rounded-md border p-2 font-mono text-xs whitespace-pre-wrap">
      {call.error}
    </pre>
  ) : (
    <Json value={call.output} />
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
    .map(([key, value]) => `${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
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
