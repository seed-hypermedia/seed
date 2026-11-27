/**
 * An agent's Private config page (it replaces "Authorship identities"): the agent's signing keys,
 * kept as its built-in `signing` private config field, its other private config, and its public
 * config. Apps show the same pieces in their settings (../apps/host-config.tsx).
 */
import type {HMDocument, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {unpackHmId} from '@shm/shared/utils/entity-id-url'
import {useState} from 'react'
import {PrivateConfigFields} from '../apps/app-settings'
import {
  SIGNING_KEY_KIND,
  SigningKeyPicker,
  SigningKeyRow,
  useHostConfig,
  useSetHostPrivateConfig,
} from '../apps/host-config'
import {useAppsPublisher} from '../apps/publish'
import {structFields, structValue, useAccountUid} from '../apps/running'
import {Button} from '../button'
import {Input} from '../components/input'
import {Label} from '../components/label'
import {useResolvedSchema} from '../schema/schema-resolve'
import {SizableText} from '../text'
import {toast} from '../toast'
import {useSigningIdentities} from './models'

export function AgentPrivateConfigPage({
  serverUrl,
  agentId,
  agentDocument,
  isOwner,
  canWrite,
}: {
  serverUrl: string | undefined
  /** The agent's hm:// document id. */
  agentId: string
  agentDocument: HMDocument | null
  isOwner: boolean
  canWrite: boolean
}) {
  const config = useHostConfig(serverUrl, agentId)
  const save = useSetHostPrivateConfig(serverUrl, agentId)
  const accountUid = useAccountUid()
  const identities = useSigningIdentities(serverUrl, accountUid)
  const docId = unpackHmId(agentId)
  const signing = config.data?.agentSigning ?? {keys: []}
  const accounts = signing.keys.map((key) => key.account)
  const primary = signing.primary ?? accounts[0]
  const places: {label: string; id: UnpackedHypermediaId}[] = docId
    ? [
        {label: 'This agent', id: docId},
        {label: 'The whole space', id: hmId(docId.uid)},
      ]
    : []
  const setSigning = (next: string[], nextPrimary: string | undefined) =>
    save.mutate(
      {
        signing: next.length
          ? {keys: Object.fromEntries(next.map((account) => [account, true])), primary: nextPrimary ?? next[0]}
          : null,
      },
      {onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not save')},
    )

  return (
    <section className="flex max-w-3xl flex-col gap-8">
      <div className="grid gap-3">
        <div className="grid gap-1">
          <SizableText weight="bold">Signing keys</SizableText>
          <SizableText size="sm" color="muted">
            The accounts this agent publishes as, kept by its server. The primary one is the agent: it publishes by
            default and others mention it. Anyone who can edit this agent can act as these keys, so give each key only
            the access it needs.
          </SizableText>
        </div>
        {signing.keys.map((key) => (
          <SigningKeyRow
            key={key.account}
            account={key.account}
            identity={identities.data?.find((identity) => identity.accountId === key.account)}
            space={docId?.uid ?? ''}
            places={places}
            badge={key.account === primary ? 'Primary' : undefined}
            actions={
              isOwner && key.account !== primary ? (
                <Button
                  size="xs"
                  variant="outline"
                  disabled={save.isLoading}
                  onClick={() => setSigning(accounts, key.account)}
                >
                  Make primary
                </Button>
              ) : null
            }
            onRemove={
              isOwner && (key.account !== primary || accounts.length === 1)
                ? () =>
                    setSigning(
                      accounts.filter((account) => account !== key.account),
                      primary,
                    )
                : undefined
            }
          />
        ))}
        {!config.isLoading && !signing.keys.length ? (
          <SizableText size="sm" color="muted">
            No signing key yet: this agent cannot publish.
          </SizableText>
        ) : null}
        {isOwner ? (
          <div>
            <SigningKeyPicker
              serverUrl={serverUrl}
              defaultName={(agentDocument?.metadata?.name as string | undefined) || 'Agent key'}
              disabled={save.isLoading}
              onPick={(account) => setSigning([...accounts, account], primary ?? account)}
            />
          </div>
        ) : (
          <SizableText size="xs" color="muted">
            Only the agent's owner changes its keys: they are held on the owner's account.
          </SizableText>
        )}
      </div>
      <HostSchemaConfig
        serverUrl={serverUrl}
        hostId={agentId}
        document={agentDocument}
        docId={docId}
        setKeys={config.data?.privateConfigKeys ?? []}
        canWrite={canWrite}
      />
    </section>
  )
}

/**
 * The private and public config a host describes with its own schemas (`privateConfigSchema`,
 * `publicConfigSchema` in its document). Private values go straight to the server and are never
 * shown again; public values are published on the document.
 */
function HostSchemaConfig({
  serverUrl,
  hostId,
  document,
  docId,
  setKeys,
  canWrite,
}: {
  serverUrl: string | undefined
  hostId: string
  document: HMDocument | null
  docId: UnpackedHypermediaId | null
  setKeys: string[]
  canWrite: boolean
}) {
  const metadata = (document?.metadata ?? {}) as Record<string, unknown>
  const privateSchema = useResolvedSchema(
    typeof metadata.privateConfigSchema === 'string' ? metadata.privateConfigSchema : undefined,
  )
  const publicSchema = useResolvedSchema(
    typeof metadata.publicConfigSchema === 'string' ? metadata.publicConfigSchema : undefined,
  )
  const privateFields = structFields(privateSchema.schema).filter((field) => field.kind !== SIGNING_KEY_KIND)
  const publicFields = structFields(publicSchema.schema)
  const save = useSetHostPrivateConfig(serverUrl, hostId)
  const publisher = useAppsPublisher()
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const publicConfig = (metadata.publicConfig ?? {}) as Record<string, unknown>
  const [publicDraft, setPublicDraft] = useState<Record<string, string> | null>(null)
  if (!privateFields.length && !publicFields.length)
    return (
      <SizableText size="sm" color="muted">
        This agent declares no other config. An agent's tools take settings from the fields its document describes with
        privateConfigSchema and publicConfigSchema.
      </SizableText>
    )
  return (
    <>
      {privateFields.length ? (
        <div className="grid gap-3">
          <div className="grid gap-1">
            <SizableText weight="bold">Private config</SizableText>
            <SizableText size="sm" color="muted">
              Values the server keeps for this agent's tools. They are never shown again; type a new value to replace
              one.
            </SizableText>
          </div>
          <PrivateConfigFields fields={privateFields} values={secrets} setKeys={setKeys} onChange={setSecrets} />
          {canWrite ? (
            <div>
              <Button
                size="sm"
                disabled={!Object.values(secrets).some(Boolean) || save.isLoading}
                onClick={() =>
                  save.mutate(structValue(privateFields, secrets), {
                    onSuccess: () => {
                      setSecrets({})
                      toast.success('Private config saved')
                    },
                    onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not save'),
                  })
                }
              >
                {save.isLoading ? 'Saving…' : 'Save'}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {publicFields.length ? (
        <div className="grid gap-3">
          <div className="grid gap-1">
            <SizableText weight="bold">Public config</SizableText>
            <SizableText size="sm" color="muted">
              Settings saved on the agent's document: anyone who can read the agent can see them.
            </SizableText>
          </div>
          {publicFields.map((field) => (
            <div key={field.name} className="grid grid-cols-[minmax(7rem,auto)_1fr] items-center gap-3">
              <Label htmlFor={`public-config-${field.name}`} className="font-mono text-sm">
                {field.name}
              </Label>
              <Input
                id={`public-config-${field.name}`}
                disabled={!canWrite}
                value={publicDraft?.[field.name] ?? stringOf(publicConfig[field.name])}
                onChange={(event) =>
                  setPublicDraft({
                    ...Object.fromEntries(publicFields.map((f) => [f.name, stringOf(publicConfig[f.name])])),
                    ...publicDraft,
                    [field.name]: event.target.value,
                  })
                }
              />
            </div>
          ))}
          {canWrite && publicDraft && docId ? (
            <div>
              <Button
                size="sm"
                onClick={async () => {
                  try {
                    const value = structValue(publicFields, publicDraft)
                    await publisher.update(docId, [
                      {
                        type: 'SetAttributes',
                        attrs: [
                          {key: ['publicConfig'], value: null},
                          ...Object.entries(value).map(([key, entry]) => ({
                            key: ['publicConfig', key],
                            value: entry as string,
                          })),
                        ],
                      },
                    ])
                    setPublicDraft(null)
                    toast.success('Public config published')
                  } catch (error) {
                    toast.error(error instanceof Error ? error.message : 'Could not publish')
                  }
                }}
              >
                Publish
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  )
}

function stringOf(value: unknown): string {
  if (value === undefined || value === null) return ''
  return typeof value === 'string' ? value : JSON.stringify(value)
}
