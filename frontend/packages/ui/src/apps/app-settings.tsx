import type {HMDocument} from '@seed-hypermedia/client/hm-types'
import {useEditorGate} from '@shm/shared/models/use-editor-gate'
import {
  selectBindingSchemaDrafts,
  selectContext,
  useDocumentSelector,
  useDocumentSend,
} from '@shm/shared/models/use-document-machine'
import {KeyRound, Play, Server, SlidersHorizontal, Square} from 'lucide-react'
import {useMemo, useState} from 'react'
import {useAgentServerUrls, useLocalAgentServerUrl} from '../agents/models'
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
import type {AppRef} from './publish'
import {appServerErrorMessage, structFields, structValue, useAppRun, useAppServerUrl, type StructField} from './running'

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
  const server = useAppServerUrl(app.id, draftApp.document)
  const appRun = useAppRun(server.serverUrl, app.id.id)
  const publicFields = structFields(publicSchema.schema)
  const privateFields = structFields(privateSchema.schema)
  const publicConfig = (metadata.publicConfig ?? {}) as Record<string, unknown>
  const openSchemas = () =>
    schemasDialog.open({
      publicSchema: publicSchema.schema ?? null,
      privateSchema: privateSchema.schema ?? null,
      onDone: change,
    })

  return (
    <section className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-8 overflow-y-auto p-4 pt-6">
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
        serverUrl={server.serverUrl}
        serverLoading={server.isLoading}
        appRun={appRun}
        canEdit={canEdit}
        hasPrivateConfig={privateFields.length > 0}
        onRunApp={() =>
          serverDialog.open({
            serverUrl: server.serverUrl,
            privateFields,
            onRun: async (serverUrl, privateConfig) => {
              // The server reads the app as published: put the chosen server in the draft and
              // publish it with any other unsaved settings (public config) before running.
              if (serverUrl !== server.serverUrl) change({metadata: {appEnvironmentUrl: serverUrl}})
              if (serverUrl !== server.serverUrl || hasDraft) send({type: 'publish.start'} as never)
              await appRun.run.mutateAsync({serverUrl, privateConfig})
              toast.success('App is running')
            },
          })
        }
        onEditPrivateConfig={() =>
          privateDialog.open({
            privateFields,
            setKeys: appRun.status.data?.privateConfigKeys ?? [],
            onSave: async (privateConfig) => {
              await appRun.run.mutateAsync({serverUrl: server.serverUrl, privateConfig})
              toast.success('Private config updated')
            },
          })
        }
      />
    </section>
  )
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
}: {
  fields: StructField[]
  values: Record<string, unknown>
  canEdit: boolean
  onChange: (next: Record<string, unknown>) => void
}) {
  if (!fields.length) return null
  return (
    <SettingsSection label="Public config">
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
  serverUrl,
  serverLoading,
  appRun,
  canEdit,
  hasPrivateConfig,
  onRunApp,
  onEditPrivateConfig,
}: {
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
  const label = checking ? 'Checking…' : running ? `Running on ${host}` : 'App not yet running'
  const description = checking
    ? null
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
        icon={<Server />}
        label={label}
        description={description}
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
            <Button size="sm" variant="brand" onClick={onRunApp}>
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

/** Runs the app: the server that runs it, and its private config, which goes only to that server. */
function RunAppDialog({
  input,
  onClose,
}: {
  input: {
    serverUrl: string
    privateFields: StructField[]
    onRun: (serverUrl: string, privateConfig: Record<string, unknown>) => Promise<void>
  }
  onClose: () => void
}) {
  const local = useLocalAgentServerUrl().data
  const configured = useAgentServerUrls().data ?? []
  const choices = Array.from(new Set([input.serverUrl, local, ...configured].filter((url): url is string => !!url)))
  const [url, setUrl] = useState(input.serverUrl || local || '')
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const custom = !choices.includes(url)
  const missing = input.privateFields.filter((field) => field.required && !secrets[field.name])
  return (
    <div className="grid gap-5">
      <div className="grid gap-1">
        <DialogTitle>Run app</DialogTitle>
        <DialogDescription>Anyone can call its tools once it runs.</DialogDescription>
      </div>
      <div className="grid gap-2">
        <Label>Server</Label>
        {choices.map((choice) => (
          <label key={choice} className="flex items-center gap-2 text-sm">
            <input type="radio" name="app-server" checked={url === choice} onChange={() => setUrl(choice)} />
            {describeHostServer(choice, local)}
            <span className="text-muted-foreground truncate font-mono text-xs">{choice}</span>
          </label>
        ))}
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="app-server" checked={custom} onChange={() => setUrl('')} />
          Other
        </label>
        {custom ? (
          <Input
            aria-label="App server URL"
            placeholder="https://example.com/hm/api/apps"
            value={url}
            onChange={(event) => setUrl(event.target.value.trim())}
          />
        ) : null}
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
          disabled={!/^https?:\/\//.test(url) || missing.length > 0 || busy}
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
          The settings this app takes. Changes go into the draft; publish them from the toolbar.
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
          Secrets, such as API keys: whoever runs the app fills them in, and they stay on the app server.
        </SizableText>
        <StructFieldsSchemaEditor
          schema={privateSchema}
          onSchema={setPrivateSchema}
          addLabel="Add private field"
          emptyLabel="No private config."
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
              [privateSchema, 'privateConfigSchema', input.privateSchema],
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
export function configSchema(schema: HypermediaSchema): Record<string, unknown> | null {
  return Object.keys(schema.properties ?? {}).length ? (schema as Record<string, unknown>) : null
}
