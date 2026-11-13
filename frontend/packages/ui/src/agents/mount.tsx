import {createDocumentBlobs} from '@seed-hypermedia/client'
import {isMountableAgentServerUrl, type CreateAgent} from '@seed-hypermedia/apps-protocol'
import {encodeDagCbor} from '@seed-hypermedia/client/signed-blob'
import type {HMBlockNode, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {replaceContentOps} from '@seed-hypermedia/client/apps'
import {hmId, useUniversalClient, useUniversalAppContext} from '@shm/shared'
import {useResources} from '@shm/shared/models/entity'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {canUseDocumentDestination} from '@shm/shared/utils/document-actions'
import {pathNameify} from '@shm/shared/utils/path'
import {useQuery} from '@tanstack/react-query'
import {base58btc} from 'multiformats/bases/base58'
import {useRef, useState} from 'react'
import {Bot} from 'lucide-react'
import {Button} from '../button'
import {DocumentDestinationDialog, type DocumentDestinationSubmitInput} from '../document-destination-dialog'
import {useAppDialog} from '../universal-dialog'
import {sendAgentAction, type AgentInfo} from './client'
import {useNavigate} from './navigation'
import {getAgentsPlatform} from './platform'

/**
 * Persistent invitation to give an unmounted agent a document and usable UI links. Shown only to
 * someone who can act on it: the owner, on a server that hosts mounts. Collaborators see nothing,
 * since there is nothing they can do about it.
 */
export function AgentMountBanner({agent, serverUrl}: {agent: AgentInfo; serverUrl: string}) {
  const accountUid = getAgentsPlatform().useAccountUid()
  const dialog = useAppDialog(MountAgentDialog)
  const canAdopt =
    !agent.id.startsWith('hm://') &&
    agent.accessRole === 'owner' &&
    !!accountUid &&
    isMountableAgentServerUrl(serverUrl)
  if (!canAdopt) return null
  return (
    <>
      <div
        role="region"
        aria-label="Adopt agent"
        className="bg-muted border-border flex shrink-0 items-center justify-between gap-4 border-b px-5 py-3"
      >
        <div className="flex items-center gap-3">
          <Bot className="text-muted-foreground size-5 shrink-0" />
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">Give this agent a home</span>
            <span className="text-muted-foreground text-xs">
              Adopt it into a space to share links to its sessions, tools and settings.
            </span>
          </div>
        </div>
        <Button variant="default" onClick={() => dialog.open({agent, serverUrl, accountUid: accountUid!})}>
          Adopt agent
        </Button>
      </div>
      {dialog.content}
    </>
  )
}

export {unmountedOwnedAgents} from './orphan-agents'

/** Picks a document for an orphan agent and adopts it there (the protocol action is MountAgent). */
export function MountAgentDialog({
  input,
  onClose,
}: {
  input: {agent: AgentInfo; serverUrl: string; accountUid: string}
  onClose: () => void
}) {
  const navigate = useNavigate()
  return (
    <AgentMountDestination
      accountUid={input.accountUid}
      serverUrl={input.serverUrl}
      name={input.agent.definition.name}
      // Mounting moves the agent's prompt into its document, which is its system prompt from then on.
      content={
        Array.isArray(input.agent.definition.systemPrompt)
          ? (input.agent.definition.systemPrompt as unknown as HMBlockNode[])
          : undefined
      }
      onClose={onClose}
      onSubmit={async (_destination, mount) => {
        await sendAgentAction({
          serverUrl: input.serverUrl,
          accountUid: input.accountUid,
          action: {_: 'MountAgent', agentId: input.agent.id, ...mount},
        })
        invalidateQueries(['agents'])
      }}
      onSuccess={({to}) => navigate({key: 'document', id: to, agentView: 'sessions'})}
    />
  )
}

/** A document published for an agent mount, retained across retries so a retry reuses the same signed blobs. */
export type PreparedAgentMount = {id: string; blobs: {cid: string; data: Uint8Array}[]}

/**
 * Signs the agent mount document at `to` without publishing it: a document whose `type` and
 * `agentServerUrl` attributes name the mount and whose body is the agent's instructions (its system
 * prompt), plus the writer capability when `to` is outside the signer's own space. Throws when the location is taken or the signer cannot write there.
 */
export async function prepareAgentMount({
  client,
  accountUid,
  serverUrl,
  to,
  name,
  content,
}: {
  client: ReturnType<typeof useUniversalClient>
  accountUid: string
  serverUrl: string
  to: UnpackedHypermediaId
  name: string
  /** The agent's instructions: its document is its system prompt (by default, an embed of the Agent Guide). */
  content?: HMBlockNode[]
}): Promise<PreparedAgentMount> {
  if (!isMountableAgentServerUrl(serverUrl))
    throw new Error('Use an HTTP or HTTPS app environment address without credentials')
  if (!client.getSigner) throw new Error('Signing is unavailable')
  const existing = await client.request('Resource', to)
  if (!canUseDocumentDestination(existing)) throw new Error('A document already exists here. Choose a different path.')
  const signer = client.getSigner(accountUid)
  const signerUid = base58btc.encode(new Uint8Array(await signer.getPublicKey()))
  const path = '/' + to.path!.join('/')
  const grants = to.uid === signerUid ? [] : (await client.request('ListCapabilities', {targetId: to})).capabilities
  const capability = grants.find((cap) => cap.delegate === signerUid && (cap.role === 'WRITER' || cap.role === 'AGENT'))
    ?.id
  if (to.uid !== signerUid && !capability) throw new Error('Your signing identity needs write access to this location')
  const document = await createDocumentBlobs(signer, {
    space: to.uid,
    path,
    capability,
    ops: [
      {
        type: 'SetAttributes',
        attrs: [
          {key: ['name'], value: name},
          {key: ['type'], value: 'hm://hyper.media/agent'},
          {key: ['agentServerUrl'], value: serverUrl},
        ],
      },
      ...(content?.length ? replaceContentOps([], content) : []),
    ],
  })
  const blobs = document.blobs.map((blob) => ({...blob, cid: blob.cid!}))
  if (capability) {
    const {data} = await encodeDagCbor((await client.request('GetCID', {cid: capability})).value)
    // Preserve the grant's hash algorithm; the receiving node verifies its CID and signature.
    blobs.unshift({cid: capability, data})
  }
  return {id: to.id, blobs}
}

/**
 * Finds a free child path under `parent` for an agent named `name`: its slug, or the slug with a
 * numeric suffix when that document already exists.
 */
export async function findFreeAgentMountPath(
  client: ReturnType<typeof useUniversalClient>,
  parent: UnpackedHypermediaId,
  name: string,
): Promise<UnpackedHypermediaId> {
  const slug = pathNameify(name) || 'agent'
  for (let attempt = 1; attempt <= 50; attempt++) {
    const id = hmId(parent.uid, {path: [...(parent.path || []), attempt === 1 ? slug : `${slug}-${attempt}`]})
    if (canUseDocumentDestination(await client.request('Resource', id))) return id
  }
  throw new Error(`Too many documents named "${slug}" already exist here. Choose another name.`)
}

/** Chooses and publishes a document before creating or mounting an agent at that location. */
export function AgentMountDestination({
  accountUid,
  serverUrl,
  name,
  content,
  creating = false,
  onClose,
  onSubmit,
  onSuccess,
}: {
  accountUid: string
  serverUrl: string
  name: string
  /** The document's starting body: the agent's instructions (an existing agent brings its own prompt). */
  content?: HMBlockNode[]
  creating?: boolean
  onClose: () => void
  onSubmit: (destination: DocumentDestinationSubmitInput, mount: NonNullable<CreateAgent['mount']>) => Promise<void>
  onSuccess: (destination: DocumentDestinationSubmitInput) => void
}) {
  const client = useUniversalClient()
  const {onPushPublished} = useUniversalAppContext()
  const [resumableDestination, setResumableDestination] = useState<string>()
  const prepared = useRef<PreparedAgentMount | null>(null)
  const locations = useQuery({
    queryKey: ['agent-mount-locations', accountUid],
    queryFn: async () => {
      if (!client.listWritableLocations) throw new Error('Writable locations are unavailable')
      if (!client.getSigner) throw new Error('Signing is unavailable')
      const signer = client.getSigner(accountUid)
      const signerUid = base58btc.encode(new Uint8Array(await signer.getPublicKey()))
      const roots = await client.listWritableLocations(signerUid)
      return roots.filter((root, index) => roots.findIndex((other) => other.id === root.id) === index)
    },
  })
  const resources = useResources(locations.data || [])
  async function mount(destination: DocumentDestinationSubmitInput) {
    const {to, name: documentName} = destination
    if (prepared.current?.id !== to.id) {
      prepared.current = await prepareAgentMount({
        client,
        accountUid,
        serverUrl,
        to,
        name: documentName || name,
        content,
      })
    }
    // Publish to the user's node and the agent's node. Retain the exact signed blobs for retries.
    await client.publish({blobs: prepared.current.blobs})
    setResumableDestination(to.id)
    invalidateQueries([queryKeys.ENTITY, to.id])
    invalidateQueries([queryKeys.DOC_LIST_DIRECTORY, to.uid])
    onPushPublished?.(to)
    await onSubmit(destination, {documentId: to.id, blobs: prepared.current.blobs})
  }
  if (locations.isError)
    return (
      <p role="alert">
        Could not load writable locations. <Button onClick={() => locations.refetch()}>Retry</Button>
      </p>
    )
  return (
    <DocumentDestinationDialog
      input={{id: hmId(accountUid), mode: creating ? 'create-agent' : 'mount-agent', mountName: name}}
      onClose={onClose}
      selectedAccountUid={accountUid}
      enabledModes={['mount-agent', 'create-agent']}
      resumableDestination={resumableDestination}
      writableDocuments={(locations.data || []).map((id, index) => ({
        id,
        accountsWithWrite: [accountUid],
        document: resources[index]?.data?.type === 'document' ? resources[index]!.data!.document : null,
      }))}
      onSubmit={mount}
      onSuccess={onSuccess}
    />
  )
}
