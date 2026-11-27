import {appEmbeddedChildren, HM_TOOL_TYPE, hostToolReferences} from '@seed-hypermedia/client/apps'
import {packHmId, unpackHmId, type HMDocument, type UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {loadSchemaRef, type SchemaFetchClient} from '@seed-hypermedia/client/schema-resolve'
import {useUniversalClient} from '@shm/shared'
import {useEditorGate} from '@shm/shared/models/use-editor-gate'
import {
  selectBindingSchemaDrafts,
  selectContext,
  useDocumentSelector,
  useDocumentSend,
} from '@shm/shared/models/use-document-machine'
import {useQuery} from '@tanstack/react-query'
import {KeyRound, Play, Server, SlidersHorizontal, Square} from 'lucide-react'
import {useEffect, useMemo, useState} from 'react'
import {
  getDefaultAgentServerUrl,
  useForgetAgentServer,
  useKnownAgentServerUrls,
  useLocalAgentServerUrl,
} from '../agents/models'
import {Button} from '../button'
import {DialogDescription, DialogTitle} from '../components/dialog'
import {Input} from '../components/input'
import {Label} from '../components/label'
import type {HypermediaSchema} from '../schema/engine'
import {emptyStructSchema, StructFieldsSchemaEditor} from '../schema/schema-editor'
import {useResolvedSchema} from '../schema/schema-resolve'
import {Separator} from '../separator'
import {describeHostServer} from '../server-host-card'
import {SettingsRow, SettingsSection} from '../settings-list'
import {SizableText} from '../text'
import {toast} from '../toast'
import {useAppDialog} from '../universal-dialog'
import {cn} from '../utils'
import {AppServerSelect, type AppServerOption} from './app-server-select'
import {setAttribute, useAppsPublisher, type AppRef} from './publish'
import {
  appServerErrorMessage,
  structFields,
  structValue,
  useAppRun,
  useAppServerCheck,
  useAppServerUrl,
  useSpaceAppServerUrl,
  type StructField,
} from './running'

type ConfigKey = 'publicConfigSchema' | 'privateConfigSchema'
type Change = {
  metadata?: Record<string, unknown>
  bindingSchemaDrafts?: Partial<Record<ConfigKey, Record<string, unknown> | null>>
}

/**
 * The app's settings, edited like a document: every change goes into the draft, and the toolbar's
 * Publish appears while there are unsaved changes. Top to bottom: the app's name and description
 * (edited in place), its public config (saved on the app, whether or not it runs), and hosting
 * (where it runs, and its private config, a secret that goes straight to the server, never into
 * the draft).
 */
export function AppSettingsTab({app, canEdit}: {app: AppRef; canEdit: boolean}) {
  return (
    <section className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-8 overflow-y-auto p-4 pt-6">
      <HostSettings host={app} canEdit={canEdit} kind="app" />
    </section>
  )
}

/**
 * The config of an app, or of a tool.
 *
 * An app holds the values: its public config, and under Hosting where it runs and its private
 * config. It asks for its own fields and for those its tools declare, since the app is what gives
 * a tool its config, matched by name.
 *
 * A tool only declares what it needs (Config fields). Inside an app or an agent that is all: the
 * host supplies the values. A tool in neither (`standalone`) is its author's to try, so its page
 * also takes the values the author runs it with. There is nothing to turn on.
 */
export function HostSettings({
  host: app,
  canEdit,
  kind,
  standalone = false,
}: {
  host: AppRef
  canEdit: boolean
  kind: 'app' | 'tool'
  /** For a tool: whether it is in no app or agent. */
  standalone?: boolean
}) {
  const ctx = useDocumentSelector(selectContext)
  const bindingDrafts = useDocumentSelector(selectBindingSchemaDrafts) as Partial<
    Record<ConfigKey, Record<string, unknown>>
  > | null
  const send = useDocumentSend()
  const {beginEditIfNeeded} = useEditorGate()
  // What the page shows is the draft over the published app, as a document's editor does.
  const metadata = useMemo(
    () => ({...app.document.metadata, ...(ctx?.metadata ?? {})}) as HMDocument['metadata'],
    [app.document.metadata, ctx?.metadata],
  )
  const draftApp: AppRef = useMemo(() => ({id: app.id, document: {...app.document, metadata}}), [app, metadata])
  function change(patch: Change) {
    beginEditIfNeeded()
    send({type: 'change', ...patch} as never)
  }
  const hasDraft = Object.keys(ctx?.metadata ?? {}).length > 0 || Object.keys(bindingDrafts ?? {}).length > 0
  const publicSchema = useConfigSchema(metadata.publicConfigSchema, bindingDrafts?.publicConfigSchema)
  const privateSchema = useConfigSchema(metadata.privateConfigSchema, bindingDrafts?.privateConfigSchema)
  const schemasDialog = useAppDialog(ConfigSchemasDialog, {className: 'w-full max-w-2xl'})
  const serverDialog = useAppDialog(RunAppDialog, {className: 'w-full max-w-lg'})
  const privateDialog = useAppDialog(PrivateConfigDialog, {className: 'w-full max-w-lg'})
  const server = useAppServerUrl(app.id, draftApp.document, kind === 'tool' && standalone)
  const appRun = useAppRun(server.serverUrl, app.id.id)
  const publisher = useAppsPublisher()
  // An app also asks for what its tools declare: a field of its own wins over a tool's of that name.
  const toolFields = useToolConfigFields(kind === 'app' ? app : null)
  const publicFields = withToolFields(structFields(publicSchema.schema), toolFields.data?.publicFields)
  const privateFields = withToolFields(structFields(privateSchema.schema), toolFields.data?.privateFields)
  const publicConfig = (metadata.publicConfig ?? {}) as Record<string, unknown>
  const missing = missingConfig({
    publicFields,
    privateFields,
    publicConfig,
    privateKeys: appRun.status.data ? appRun.status.data.privateConfigKeys : null,
  })
  const openSchemas = () =>
    schemasDialog.open({
      publicSchema: publicSchema.schema ?? null,
      privateSchema: privateSchema.schema ?? null,
      onDone: change,
    })
  const openPrivateConfig = () =>
    privateDialog.open({
      privateFields,
      setKeys: appRun.status.data?.privateConfigKeys ?? [],
      onSave: async (privateConfig) => {
        await appRun.run.mutateAsync({serverUrl: server.serverUrl, privateConfig})
        toast.success('Private config updated')
      },
    })

  if (kind === 'tool')
    return (
      <>
        {schemasDialog.content}
        {privateDialog.content}
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <SizableText size="sm" weight="bold">
              Config
            </SizableText>
            <SizableText size="sm" color="muted">
              {standalone
                ? 'What the tool reads from ctx.publicConfig and ctx.privateConfig. An app or an agent that takes this tool supplies these values; here you set the ones you run it with.'
                : 'What the tool reads from ctx.publicConfig and ctx.privateConfig. The app this tool is in supplies the values, in its Settings.'}
            </SizableText>
          </div>
          {canEdit ? (
            <Button size="sm" variant="outline" className="shrink-0" onClick={openSchemas}>
              <SlidersHorizontal className="size-4" /> Config fields
            </Button>
          ) : null}
        </div>
        {standalone ? (
          <>
            <PublicConfigSection
              fields={publicFields}
              values={publicConfig}
              canEdit={canEdit}
              onChange={(next) => change({metadata: {publicConfig: next}})}
            />
            {privateFields.length && canEdit ? (
              <SettingsSection label="Private config">
                <SettingsRow
                  icon={<KeyRound />}
                  label={privateConfigLabel(privateFields, appRun.status.data?.privateConfigKeys ?? [])}
                  description={
                    server.serverUrl
                      ? `Kept by ${describeHostServer(server.serverUrl, undefined)} for your own runs. Never published.`
                      : 'You have no app environment to keep them.'
                  }
                  action={
                    server.serverUrl ? (
                      <Button size="sm" variant="outline" onClick={openPrivateConfig}>
                        <KeyRound className="size-4" /> Set
                      </Button>
                    ) : null
                  }
                />
              </SettingsSection>
            ) : null}
          </>
        ) : null}
      </>
    )

  return (
    <>
      {schemasDialog.content}
      {serverDialog.content}
      {privateDialog.content}
      <AppHeader
        name={metadata.name ?? ''}
        summary={metadata.summary ?? ''}
        canEdit={canEdit}
        onName={(name) => change({metadata: {name}})}
        onSummary={(summary) => change({metadata: {summary}})}
        onEditConfig={openSchemas}
      />
      <PublicConfigSection
        fields={publicFields}
        values={publicConfig}
        canEdit={canEdit}
        onChange={(next) => change({metadata: {publicConfig: next}})}
      />
      <HostingSection
        missing={missing}
        serverUrl={server.serverUrl}
        serverLoading={server.isLoading}
        appRun={appRun}
        canEdit={canEdit}
        hasPrivateConfig={privateFields.length > 0}
        onRunApp={() =>
          serverDialog.open({
            appId: app.id.id,
            spaceUid: app.id.uid,
            serverUrl: server.serverUrl,
            privateFields,
            onRun: async (serverUrl, privateConfig) => {
              // An app runs only on the server it names, and the server checks the app as published:
              // publish the chosen server first and wait for it, then run. The draft takes the same
              // value so a later publish keeps it; other unsaved settings (public config) publish too.
              const published = app.document.metadata.appEnvironmentUrl
              if (serverUrl !== published && serverUrl !== server.serverUrl) {
                await publisher.update(app.id, [setAttribute('appEnvironmentUrl', serverUrl)])
                change({metadata: {appEnvironmentUrl: serverUrl}})
              }
              if (hasDraft) send({type: 'publish.start'} as never)
              await appRun.run.mutateAsync({serverUrl, privateConfig})
              toast.success('App is running')
            },
          })
        }
        onEditPrivateConfig={openPrivateConfig}
      />
    </>
  )
}

/**
 * The secrets a host's tools declare, and the way to give them to the host's server. An app has
 * this in its Settings; this is for an agent, which has no config of its own.
 *
 * The values go to the server that runs the agent, which keeps them encrypted and hands a tool the
 * ones it declares, by name. They are not put in the agent's memory: the model reads its memory,
 * and a secret it can read can end up in a conversation or a published document.
 */
export function HostToolSecrets({host, canEdit}: {host: AppRef; canEdit: boolean}) {
  const server = useAppServerUrl(host.id, host.document)
  const hostRun = useAppRun(server.serverUrl, host.id.id)
  const toolFields = useToolConfigFields(host)
  const privateDialog = useAppDialog(PrivateConfigDialog, {className: 'w-full max-w-lg'})
  const privateFields = toolFields.data?.privateFields ?? []
  if (!privateFields.length) return null
  const setKeys = hostRun.status.data?.privateConfigKeys ?? []
  const missing = privateFields.filter((field) => field.required && !setKeys.includes(field.name))
  return (
    <>
      {privateDialog.content}
      <SettingsSection label="Tool secrets">
        <SettingsRow
          icon={<KeyRound />}
          label={privateConfigLabel(privateFields, setKeys)}
          description={
            missing.length ? (
              <span role="alert" className="text-destructive">
                Not set: {missing.map((field) => field.name).join(', ')}. The tools that need them fail until they are.
              </span>
            ) : server.serverUrl ? (
              `Kept by ${describeHostServer(
                server.serverUrl,
                undefined,
              )} for this agent’s tools. Never published, and never shown to the agent.`
            ) : (
              'This agent names no server to keep them.'
            )
          }
          action={
            canEdit && server.serverUrl ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  privateDialog.open({
                    privateFields,
                    setKeys,
                    onSave: async (privateConfig) => {
                      await hostRun.run.mutateAsync({serverUrl: server.serverUrl, privateConfig})
                      toast.success('Tool secrets updated')
                    },
                  })
                }
              >
                <KeyRound className="size-4" /> Set
              </Button>
            ) : null
          }
        />
      </SettingsSection>
    </>
  )
}

/**
 * The settings an agent's tools declare (their `publicConfigSchema`), set on the agent. An app sets
 * them in its Settings; an agent has no config of its own, so its tools' settings are asked for
 * here, beside their secrets. They are saved in the agent's document as its `publicConfig`, where a
 * tool reads them as `ctx.publicConfig`. Anyone who can read the agent can read them: a secret
 * belongs in the tool secrets above, never here. Nothing is published until Save.
 */
export function HostToolSettings({host, canEdit}: {host: AppRef; canEdit: boolean}) {
  const publisher = useAppsPublisher()
  const toolFields = useToolConfigFields(host)
  const [edited, setEdited] = useState<Record<string, unknown> | null>(null)
  const [saving, setSaving] = useState(false)
  const fields = toolFields.data?.publicFields ?? []
  if (!fields.length) return null
  const saved = (host.document.metadata.publicConfig ?? {}) as Record<string, unknown>
  const values = edited ?? saved
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
  const changed = fields.filter((field) => !same(values[field.name], saved[field.name]))
  async function save() {
    setSaving(true)
    try {
      const attrs = changed.map((field) => {
        const value = values[field.name] ?? null
        // A document attribute holds one plain value; a tool setting that is a list or an object
        // cannot be saved this way.
        if (value !== null && typeof value === 'object')
          throw new Error(`${field.name} is not a plain value and cannot be set here`)
        return {key: ['publicConfig', field.name], value: value as string | number | boolean | null}
      })
      await publisher.update(host.id, [{type: 'SetAttributes', attrs}])
      setEdited(null)
      toast.success('Tool settings saved')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="flex flex-col gap-2" data-testid="host-tool-settings">
      <PublicConfigSection
        label="Tool settings"
        fields={fields}
        values={values}
        canEdit={canEdit}
        onChange={setEdited}
      />
      {canEdit ? (
        <div className="flex items-center justify-between gap-3">
          <SizableText size="xs" color="muted">
            Saved in the agent’s document, which anyone who can read the agent can see. A field left empty uses the
            tool’s own default.
          </SizableText>
          <Button size="sm" variant="outline" disabled={!changed.length || saving} onClick={() => void save()}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      ) : null}
    </div>
  )
}

/** How many of a tool's secrets the server holds, in words. */
function privateConfigLabel(fields: StructField[], setKeys: string[]): string {
  const set = fields.filter((field) => setKeys.includes(field.name)).length
  return set === fields.length ? `${fields.length} of ${fields.length} set` : `${set} of ${fields.length} set`
}

/** The names of the required config fields an app lacks. */
export type MissingConfig = {public: string[]; private: string[]}

/**
 * Which required config an app lacks. A public field is missing when the app's public config has no
 * value for it. A private one is missing when the server says it holds none: `privateKeys` is the
 * names it holds, or null while the app does not run (the Run dialog then asks for them).
 */
export function missingConfig({
  publicFields,
  privateFields,
  publicConfig,
  privateKeys,
}: {
  publicFields: StructField[]
  privateFields: StructField[]
  publicConfig: Record<string, unknown>
  privateKeys: string[] | null
}): MissingConfig {
  const empty = (value: unknown) => value === undefined || value === null || value === ''
  return {
    public: publicFields.filter((field) => field.required && empty(publicConfig[field.name])).map((f) => f.name),
    private: privateKeys
      ? privateFields.filter((field) => field.required && !privateKeys.includes(field.name)).map((f) => f.name)
      : [],
  }
}

/**
 * The required config an app, as published, lacks: its own fields and those its tools declare. For
 * the places that show an app without editing it.
 */
export function useAppMissingConfig(app: AppRef): MissingConfig {
  const server = useAppServerUrl(app.id, app.document)
  const {status} = useAppRun(server.serverUrl, app.id.id)
  const publicSchema = useResolvedSchema(configRef(app.document.metadata.publicConfigSchema))
  const privateSchema = useResolvedSchema(configRef(app.document.metadata.privateConfigSchema))
  const toolFields = useToolConfigFields(app)
  return missingConfig({
    publicFields: withToolFields(structFields(publicSchema.schema), toolFields.data?.publicFields),
    privateFields: withToolFields(structFields(privateSchema.schema), toolFields.data?.privateFields),
    publicConfig: (app.document.metadata.publicConfig ?? {}) as Record<string, unknown>,
    privateKeys: status.data ? status.data.privateConfigKeys : null,
  })
}

const configRef = (ref: unknown) => (typeof ref === 'string' ? ref : undefined)

/**
 * The required config a tool cannot run without, for its Run form, and how to set it from there.
 * `host` is what supplies the config: the app or agent the tool is in, as published, or the tool
 * itself when it stands on its own, as the page shows it (its draft included). A tool on its own
 * has no run until its private config is set, so a server that holds nothing for it holds none of
 * its fields. `setPrivate` opens the private config for a tool on its own that someone can edit.
 */
export function useToolRunConfig({host, standalone, canEdit}: {host: AppRef; standalone: boolean; canEdit: boolean}): {
  missing: MissingConfig
  setPrivate?: () => void
  dialog: React.ReactNode
} {
  const bindingDrafts = useDocumentSelector(selectBindingSchemaDrafts) as Partial<
    Record<ConfigKey, Record<string, unknown>>
  > | null
  const metadata = host.document.metadata
  const server = useAppServerUrl(host.id, host.document, standalone)
  const appRun = useAppRun(server.serverUrl, host.id.id)
  // The fields a tool on its own is drafting count too: they are what the page asks for.
  const publicSchema = useConfigSchema(
    metadata.publicConfigSchema,
    standalone ? bindingDrafts?.publicConfigSchema : undefined,
  )
  const privateSchema = useConfigSchema(
    metadata.privateConfigSchema,
    standalone ? bindingDrafts?.privateConfigSchema : undefined,
  )
  const toolFields = useToolConfigFields(standalone ? null : host)
  const privateFields = withToolFields(structFields(privateSchema.schema), toolFields.data?.privateFields)
  const privateDialog = useAppDialog(PrivateConfigDialog, {className: 'w-full max-w-lg'})
  const status = appRun.status
  const settled = !!server.serverUrl && !server.isLoading && !status.isLoading && !status.isError
  const missing = missingConfig({
    publicFields: withToolFields(structFields(publicSchema.schema), toolFields.data?.publicFields),
    privateFields,
    publicConfig: (metadata.publicConfig ?? {}) as Record<string, unknown>,
    privateKeys: status.data ? status.data.privateConfigKeys : standalone && settled ? [] : null,
  })
  const setPrivate =
    standalone && canEdit && server.serverUrl
      ? () =>
          privateDialog.open({
            privateFields,
            setKeys: status.data?.privateConfigKeys ?? [],
            onSave: async (privateConfig) => {
              await appRun.run.mutateAsync({serverUrl: server.serverUrl, privateConfig})
              toast.success('Private config updated')
            },
          })
      : undefined
  return {missing, setPrivate, dialog: privateDialog.content}
}

/** A host's own config fields, then those its tools declare under names the host does not use. */
export function withToolFields(own: StructField[], fromTools: StructField[] | undefined): StructField[] {
  const names = new Set(own.map((field) => field.name))
  const added: StructField[] = []
  for (const field of fromTools ?? []) {
    if (names.has(field.name)) continue
    names.add(field.name)
    added.push(field)
  }
  return [...own, ...added]
}

/**
 * The config fields a list of tools declare (their own `publicConfigSchema` and
 * `privateConfigSchema`), each described by the tool that needs it. A document that is not a tool,
 * or a schema that cannot be read, adds nothing.
 */
export async function toolConfigFields(
  client: Pick<ReturnType<typeof useUniversalClient>, 'request'>,
  tools: UnpackedHypermediaId[],
): Promise<{publicFields: StructField[]; privateFields: StructField[]}> {
  const publicFields: StructField[] = []
  const privateFields: StructField[] = []
  for (const toolId of tools) {
    const resource = await client.request('Resource', toolId).catch(() => null)
    if (resource?.type !== 'document' || resource.document.metadata.type !== HM_TOOL_TYPE) continue
    const metadata = resource.document.metadata as Record<string, unknown>
    const toolName = typeof metadata.name === 'string' && metadata.name ? metadata.name : toolId.path?.at(-1)
    for (const [key, into] of [
      ['publicConfigSchema', publicFields],
      ['privateConfigSchema', privateFields],
    ] as const) {
      const ref = metadata[key]
      if (typeof ref !== 'string' || !ref) continue
      const loaded = await loadSchemaRef(client as unknown as SchemaFetchClient, ref).catch(() => null)
      for (const field of structFields(loaded?.schema as HypermediaSchema | undefined))
        into.push({
          ...field,
          description: field.description ? `${field.description} (for ${toolName})` : `For ${toolName}`,
        })
    }
  }
  return {publicFields, privateFields}
}

/**
 * The config fields an app's tools declare. The app gives a tool its config by name, so these are
 * fields of the app's settings too.
 */
function useToolConfigFields(app: AppRef | null) {
  const client = useUniversalClient()
  // Its own tools, and the ones it references, each at the version the app runs.
  const tools = app
    ? [
        ...appEmbeddedChildren(app.id, app.document.content).map((child) => child.id),
        ...hostToolReferences(app.id, app.document.content).map(({id, version}) =>
          version ? unpackHmId(packHmId({...id, version, latest: false}))! : id,
        ),
      ]
    : []
  return useQuery({
    queryKey: ['app-tool-config-fields', app?.id.id, tools.map((tool) => tool.id)],
    enabled: tools.length > 0,
    useErrorBoundary: false,
    staleTime: 30_000,
    queryFn: () => toolConfigFields(client, tools),
  })
}

/** A config schema: the draft's working copy when there is one, else the published reference. */
function useConfigSchema(ref: unknown, draft: Record<string, unknown> | undefined) {
  const resolved = useResolvedSchema(draft ? undefined : typeof ref === 'string' ? ref : undefined)
  return draft ? {schema: draft as HypermediaSchema, isLoading: false} : resolved
}

/** The app's name and description as the page's heading, edited in place into the draft. */
function AppHeader({
  name,
  summary,
  canEdit,
  onName,
  onSummary,
  onEditConfig,
}: {
  name: string
  summary: string
  canEdit: boolean
  onName: (name: string) => void
  onSummary: (summary: string) => void
  onEditConfig: () => void
}) {
  const field =
    'placeholder:text-muted-foreground/50 hover:bg-muted/50 focus:bg-muted/50 -mx-2 w-[calc(100%+1rem)] rounded-md bg-transparent px-2 outline-none disabled:hover:bg-transparent'
  return (
    <header className="flex items-start gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <input
          aria-label="App name"
          className={cn(field, 'py-1 text-2xl font-bold')}
          value={name}
          placeholder="Untitled app"
          disabled={!canEdit}
          onChange={(event) => onName(event.target.value)}
        />
        <textarea
          aria-label="App description"
          rows={1}
          className={cn(field, 'text-muted-foreground [field-sizing:content] resize-none py-1 text-sm')}
          value={summary}
          placeholder={canEdit ? 'Add a description' : 'No description'}
          disabled={!canEdit}
          onChange={(event) => onSummary(event.target.value)}
        />
      </div>
      {canEdit ? (
        <Button size="sm" variant="outline" className="mt-1.5 shrink-0" onClick={onEditConfig}>
          <SlidersHorizontal className="size-4" /> Config fields
        </Button>
      ) : null}
    </header>
  )
}

function FieldRow({field, children, hint}: {field: StructField; children: React.ReactNode; hint?: React.ReactNode}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="flex min-w-0 flex-col">
        <Label htmlFor={`app-config-${field.name}`} className="font-mono text-sm font-medium">
          {field.name}
          {field.required ? <span className="text-muted-foreground"> *</span> : null}
        </Label>
        <p className="text-muted-foreground text-xs">{hint ?? field.description ?? field.kind}</p>
      </div>
      <div className="w-64 shrink-0">{children}</div>
    </div>
  )
}

/** Text from a value, for an input. */
const fieldText = (value: unknown) =>
  value === undefined ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value)

/** A config object with one field's text applied: empty text leaves the field out. */
function withFieldText(values: Record<string, unknown>, field: StructField, text: string) {
  const next = {...values}
  if (text === '') delete next[field.name]
  else Object.assign(next, structValue([field], {[field.name]: text}))
  return next
}

/** Public config: values saved on the app itself, which anyone who can read it sees. Absent without fields. */
function PublicConfigSection({
  fields,
  values,
  canEdit,
  onChange,
  label = 'Public config',
}: {
  fields: StructField[]
  values: Record<string, unknown>
  canEdit: boolean
  onChange: (next: Record<string, unknown>) => void
  label?: string
}) {
  if (!fields.length) return null
  return (
    <SettingsSection label={label}>
      {fields.map((field, index) => (
        <div key={field.name}>
          {index ? <Separator /> : null}
          <FieldRow field={field}>
            <Input
              id={`app-config-${field.name}`}
              className="bg-background"
              value={fieldText(values[field.name])}
              disabled={!canEdit}
              onChange={(event) => onChange(withFieldText(values, field, event.target.value))}
            />
          </FieldRow>
        </div>
      ))}
    </SettingsSection>
  )
}

/**
 * Where the app runs: whether it runs, with Run App or Stop, and the private config behind a
 * dialog (secrets the server keeps and never shows back).
 */
function HostingSection({
  missing,
  serverUrl,
  serverLoading,
  appRun,
  canEdit,
  hasPrivateConfig,
  onRunApp,
  onEditPrivateConfig,
}: {
  /** Required config the app does not have yet. */
  missing: MissingConfig
  serverUrl: string
  serverLoading: boolean
  appRun: ReturnType<typeof useAppRun>
  canEdit: boolean
  hasPrivateConfig: boolean
  onRunApp: () => void
  onEditPrivateConfig: () => void
}) {
  const local = useLocalAgentServerUrl().data
  const {status, stop} = appRun
  const running = status.data
  const host = describeHostServer(serverUrl, local)
  const checking = serverLoading || (!!serverUrl && status.isInitialLoading)
  // An app that lacks required config is shown in red: its tools that need it fail until it is set.
  // Public config must be there before the app runs; the Run dialog asks for the secrets itself.
  const lacksSecrets = !!running && missing.private.length > 0
  const lacksPublic = missing.public.length > 0
  const incomplete = !checking && (lacksSecrets || lacksPublic)
  const label = checking
    ? 'Checking…'
    : running
      ? incomplete
        ? `Running on ${host}, with config missing`
        : `Running on ${host}`
      : 'App not yet running'
  const description = checking
    ? null
    : incomplete
      ? `Not set: ${[...missing.public, ...missing.private].join(', ')}. ${
          lacksPublic ? 'Fill the required public config above' : 'Set them under Private config'
        }${running ? '; the tools that need them fail until then.' : ' before running the app.'}`
      : running
        ? host !== serverUrl
          ? serverUrl
          : null
        : status.isError
          ? `${appServerErrorMessage(status.error)} (${host})`
          : serverUrl
            ? `Runs on ${host}`
            : 'Choose a server to run it'

  return (
    <SettingsSection label="Hosting">
      <SettingsRow
        icon={<Server className={incomplete ? 'text-destructive' : undefined} />}
        label={label}
        description={
          incomplete ? (
            <span className="text-destructive" role="alert">
              {description}
            </span>
          ) : (
            description
          )
        }
        action={
          !canEdit || checking ? null : running ? (
            <div className="flex gap-2">
              {hasPrivateConfig ? (
                <Button size="sm" variant="outline" onClick={onEditPrivateConfig}>
                  <KeyRound className="size-4" /> Private config
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                disabled={stop.isLoading}
                onClick={() => stop.mutate(undefined, {onError: (error) => toast.error(appServerErrorMessage(error))})}
              >
                <Square className="size-4" /> Stop
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="brand" disabled={lacksPublic} onClick={onRunApp}>
              <Play className="size-4" /> Run App
            </Button>
          )
        }
      />
    </SettingsSection>
  )
}

/** Password inputs for the app's private config; `setKeys` are already on the server. */
function PrivateConfigFields({
  fields,
  values,
  setKeys = [],
  onChange,
}: {
  fields: StructField[]
  values: Record<string, string>
  setKeys?: string[]
  onChange: (values: Record<string, string>) => void
}) {
  return (
    <div className="grid gap-3">
      {fields.map((field) => (
        <div key={field.name} className="grid grid-cols-[minmax(7rem,auto)_1fr] items-center gap-3">
          <Label htmlFor={`private-config-${field.name}`} className="flex flex-col items-start gap-0">
            <span className="font-mono text-sm">
              {field.name}
              {field.required ? <span className="text-muted-foreground"> *</span> : null}
            </span>
            <span className="text-muted-foreground text-xs font-normal">
              {setKeys.includes(field.name) ? 'Set on the server' : field.description ?? field.kind}
            </span>
          </Label>
          <Input
            id={`private-config-${field.name}`}
            type="password"
            autoComplete="off"
            placeholder={setKeys.includes(field.name) ? '••••••••  (unchanged)' : ''}
            value={values[field.name] ?? ''}
            onChange={(event) => onChange({...values, [field.name]: event.target.value})}
          />
        </div>
      ))}
    </div>
  )
}

/**
 * Runs the app: the server that runs it, and its private config, which goes only to that server.
 * The server starts on the one the app already names, else the one its space's site advertises,
 * and Run App waits for the chosen server to say it will run this app for the signed-in account.
 */
function RunAppDialog({
  input,
  onClose,
}: {
  input: {
    appId: string
    spaceUid: string
    serverUrl: string
    privateFields: StructField[]
    onRun: (serverUrl: string, privateConfig: Record<string, unknown>) => Promise<void>
  }
  onClose: () => void
}) {
  const local = useLocalAgentServerUrl().data
  const space = useSpaceAppServerUrl(input.spaceUid).serverUrl
  const known = useKnownAgentServerUrls().data
  const forget = useForgetAgentServer()
  const options = useMemo(() => {
    const byUrl = new Map<string, AppServerOption>()
    const offer = (url: string | null | undefined, extra: Omit<AppServerOption, 'url'> = {}) => {
      if (url && !byUrl.has(url)) byUrl.set(url, {url, ...extra})
    }
    offer(space)
    offer(input.serverUrl)
    offer(local)
    for (const url of known ?? []) offer(url, {onForget: () => forget.mutate(url)})
    offer(getDefaultAgentServerUrl())
    return Array.from(byUrl.values())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [space, input.serverUrl, local, known])
  const [url, setUrl] = useState(input.serverUrl || space || local || '')
  // The space's server and the local one arrive after the dialog opens; nothing chosen yet takes them.
  useEffect(() => {
    if (!url) setUrl(space || local || '')
  }, [url, space, local])
  const check = useAppServerCheck(url, input.appId)
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const missing = input.privateFields.filter((field) => field.required && !secrets[field.name])
  return (
    <div className="grid gap-5">
      <div className="grid gap-1">
        <DialogTitle>Run app</DialogTitle>
        <DialogDescription>Anyone can call its tools once it runs.</DialogDescription>
      </div>
      <div className="grid gap-2">
        <Label>Server</Label>
        <AppServerSelect appId={input.appId} value={url} onChange={setUrl} options={options} localServerUrl={local} />
      </div>
      {input.privateFields.length ? (
        <div className="grid gap-2">
          <Label className="flex items-center gap-1.5">
            <KeyRound className="size-3.5" /> Private config
          </Label>
          <SizableText size="xs" color="muted">
            Kept by the app server, never published and never shown again.
          </SizableText>
          <PrivateConfigFields fields={input.privateFields} values={secrets} onChange={setSecrets} />
        </div>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="brand"
          disabled={!url || !check.data?.allowed || missing.length > 0 || busy}
          onClick={async () => {
            setBusy(true)
            try {
              await input.onRun(url, structValue(input.privateFields, secrets))
              onClose()
            } catch (error) {
              toast.error(appServerErrorMessage(error))
            } finally {
              setBusy(false)
            }
          }}
        >
          <Play className="size-4" /> {busy ? 'Starting…' : 'Run App'}
        </Button>
      </div>
    </div>
  )
}

/** Changes the private config of a running app: the fields typed replace theirs, the rest keep their values. */
function PrivateConfigDialog({
  input,
  onClose,
}: {
  input: {
    privateFields: StructField[]
    setKeys: string[]
    onSave: (privateConfig: Record<string, unknown>) => Promise<void>
  }
  onClose: () => void
}) {
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const typed = Object.values(secrets).some(Boolean)
  return (
    <div className="grid gap-5">
      <div className="grid gap-1">
        <DialogTitle>Private config</DialogTitle>
        <DialogDescription>
          Values the app server keeps for this app. They are never shown again; type a new value to replace one.
        </DialogDescription>
      </div>
      <PrivateConfigFields
        fields={input.privateFields}
        values={secrets}
        setKeys={input.setKeys}
        onChange={setSecrets}
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="default"
          disabled={!typed || busy}
          onClick={async () => {
            setBusy(true)
            try {
              await input.onSave(structValue(input.privateFields, secrets))
              onClose()
            } catch (error) {
              toast.error(appServerErrorMessage(error))
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  )
}

/** Sets up the app's two config schemas: which fields it has, public and private. Done puts them in the draft. */
export function ConfigSchemasDialog({
  input,
  onClose,
}: {
  input: {
    publicSchema: HypermediaSchema | null
    privateSchema: HypermediaSchema | null
    onDone: (change: Change) => void
  }
  onClose: () => void
}) {
  const [publicSchema, setPublicSchema] = useState<HypermediaSchema>(input.publicSchema ?? emptyStructSchema())
  const [privateSchema, setPrivateSchema] = useState<HypermediaSchema>(input.privateSchema ?? emptyStructSchema())
  const names = [...Object.keys(publicSchema.properties ?? {}), ...Object.keys(privateSchema.properties ?? {})]
  const badName = names.some((field) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(field))
  const clash = new Set(names).size !== names.length
  return (
    <div className="grid max-h-[80vh] gap-5 overflow-y-auto">
      <div className="grid gap-1">
        <DialogTitle>Config fields</DialogTitle>
        <DialogDescription>
          The settings and secrets this takes. Changes go into the draft; publish them from the toolbar.
        </DialogDescription>
      </div>
      <div className="grid gap-1">
        <Label>Public config</Label>
        <SizableText size="xs" color="muted">
          Set in the app's settings and saved on the app; anyone who can read the app can see these values.
        </SizableText>
        <StructFieldsSchemaEditor
          schema={publicSchema}
          onSchema={setPublicSchema}
          addLabel="Add public field"
          emptyLabel="No public config."
        />
      </div>
      <div className="grid gap-1">
        <Label>Private config</Label>
        <SizableText size="xs" color="muted">
          Secrets, such as API keys: whoever runs the app fills them in, and they stay on the app server. Only the field
          names are published, so a secret has no default value here.
        </SizableText>
        <StructFieldsSchemaEditor
          schema={privateSchema}
          onSchema={setPrivateSchema}
          addLabel="Add private field"
          emptyLabel="No private config."
          noDefaults
        />
      </div>
      {badName || clash ? (
        <SizableText size="xs" className="text-destructive">
          {clash
            ? 'Public and private fields need different names.'
            : 'Field names are letters, digits and _, not starting with a digit.'}
        </SizableText>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="default"
          disabled={badName || clash}
          onClick={() => {
            const metadata: Record<string, unknown> = {}
            const bindingSchemaDrafts: Change['bindingSchemaDrafts'] = {}
            for (const [schema, key, before] of [
              [publicSchema, 'publicConfigSchema', input.publicSchema],
              // A default set before this dialog stopped offering one must not be published again.
              [withoutDefaults(privateSchema), 'privateConfigSchema', input.privateSchema],
            ] as const) {
              const after = configSchema(schema)
              if (JSON.stringify(after) === JSON.stringify(before ?? null)) continue
              bindingSchemaDrafts[key] = after
              // No fields left also drops the published reference.
              if (!after && before) metadata[key] = ''
            }
            if (Object.keys(bindingSchemaDrafts).length)
              input.onDone({...(Object.keys(metadata).length ? {metadata} : {}), bindingSchemaDrafts})
            onClose()
          }}
        >
          Done
        </Button>
      </div>
    </div>
  )
}

/** A config schema as the app keeps it: the struct, or null once it has no fields. */
/**
 * A struct schema with every field's default removed. For the schema of secrets: a schema is
 * published, so a default in it would publish the secret to everyone who can read the document,
 * and to every copy of it.
 */
export function withoutDefaults(schema: HypermediaSchema): HypermediaSchema {
  const properties = (schema.properties ?? {}) as Record<string, Record<string, unknown>>
  if (!Object.values(properties).some((property) => 'default' in property)) return schema
  return {
    ...schema,
    properties: Object.fromEntries(
      Object.entries(properties).map(([name, {default: _dropped, ...property}]) => [name, property]),
    ),
  } as HypermediaSchema
}

export function configSchema(schema: HypermediaSchema): Record<string, unknown> | null {
  return Object.keys(schema.properties ?? {}).length ? (schema as Record<string, unknown>) : null
}
