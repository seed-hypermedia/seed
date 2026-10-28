import {createDocumentBlobs} from '@seed-hypermedia/client'
import {isMountableAgentServerUrl, type CreateAgent} from '@seed-hypermedia/agents-protocol'
import {encodeDagCbor} from '@seed-hypermedia/client/signed-blob'
import {hmId, useUniversalClient, useUniversalAppContext} from '@shm/shared'
import {useResources} from '@shm/shared/models/entity'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {canUseDocumentDestination} from '@shm/shared/utils/document-actions'
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

/** Persistent invitation to give an unmounted agent a document and usable UI links. */
export function AgentMountBanner({agent, serverUrl}: {agent: AgentInfo; serverUrl: string}) {
  const accountUid = getAgentsPlatform().useAccountUid()
  const dialog = useAppDialog(MountAgentDialog)
  const canMount = isMountableAgentServerUrl(serverUrl)
  if (agent.id.startsWith('hm://')) return null
  return (
    <>
      <div
        role="region"
        aria-label="Mount agent"
        className="bg-muted border-border flex shrink-0 items-center justify-between gap-4 border-b px-5 py-3"
      >
        <div className="flex items-center gap-3">
          <Bot className="text-muted-foreground size-5 shrink-0" />
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium">Give this agent a home</span>
            <span className="text-muted-foreground text-xs">
              {agent.accessRole === 'owner'
                ? 'Mount it in a document to share links to sessions, tools and settings.'
                : 'Ask the owner to mount this agent in a document.'}
            </span>
          </div>
        </div>
        {canMount && accountUid && agent.accessRole === 'owner' && (
          <Button variant="default" onClick={() => dialog.open({agent, serverUrl, accountUid})}>
            Mount agent
          </Button>
        )}
      </div>
      {dialog.content}
    </>
  )
}

function MountAgentDialog({
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

/** Chooses and publishes a document before creating or mounting an agent at that location. */
export function AgentMountDestination({
  accountUid,
  serverUrl,
  name,
  creating = false,
  onClose,
  onSubmit,
  onSuccess,
}: {
  accountUid: string
  serverUrl: string
  name: string
  creating?: boolean
  onClose: () => void
  onSubmit: (destination: DocumentDestinationSubmitInput, mount: NonNullable<CreateAgent['mount']>) => Promise<void>
  onSuccess: (destination: DocumentDestinationSubmitInput) => void
}) {
  const client = useUniversalClient()
  const {onPushPublished} = useUniversalAppContext()
  const [resumableDestination, setResumableDestination] = useState<string>()
  const prepared = useRef<{id: string; blobs: {cid: string; data: Uint8Array}[]} | null>(null)
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
    if (!isMountableAgentServerUrl(serverUrl))
      throw new Error('Use an HTTP or HTTPS agent server address without credentials')
    if (!client.getSigner) throw new Error('Signing is unavailable')
    if (prepared.current?.id !== to.id) {
      const existing = await client.request('Resource', to)
      if (!canUseDocumentDestination(existing))
        throw new Error('A document already exists here. Choose a different path.')
      const signer = client.getSigner(accountUid)
      const signerUid = base58btc.encode(new Uint8Array(await signer.getPublicKey()))
      const path = '/' + to.path!.join('/')
      const grants = to.uid === signerUid ? [] : (await client.request('ListCapabilities', {targetId: to})).capabilities
      const capability = grants.find(
        (cap) => cap.delegate === signerUid && (cap.role === 'WRITER' || cap.role === 'AGENT'),
      )?.id
      if (to.uid !== signerUid && !capability)
        throw new Error('Your signing identity needs write access to this location')
      const document = await createDocumentBlobs(signer, {
        space: to.uid,
        path,
        capability,
        ops: [
          {
            type: 'SetAttributes',
            attrs: [
              {key: ['name'], value: documentName || name},
              {key: ['type'], value: 'hm://hyper.media/agent'},
              {key: ['agentServerUrl'], value: serverUrl},
            ],
          },
        ],
      })
      const blobs = document.blobs.map((blob) => ({...blob, cid: blob.cid!}))
      if (capability) {
        const {data} = await encodeDagCbor((await client.request('GetCID', {cid: capability})).value)
        // Preserve the grant's hash algorithm; the receiving node verifies its CID and signature.
        blobs.unshift({cid: capability, data})
      }
      prepared.current = {id: to.id, blobs}
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
