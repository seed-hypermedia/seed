import {parentDocumentId} from '@seed-hypermedia/client/apps'
import type {HMDocument, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useResource} from '@shm/shared/models/entity'
import {useNavigate} from '@shm/shared/utils/navigation'
import type {ReactNode} from 'react'
import {AgentSubpageHeader} from '../agents/header'
import {SizableText} from '../text'
import {
  appServerErrorMessage,
  CallerName,
  CallOutcome,
  CallOutput,
  formatDuration,
  Json,
  useAppServerUrl,
  useAppToolCall,
} from './running'

/**
 * One run of a tool as its own page (`<tool>/:call/<id>`): who triggered it, when, the tool version
 * that ran, and its input and result. Inside the app like the tool page, with a way back to it.
 */
export function ToolCallView({
  toolId,
  document,
  callId,
}: {
  toolId: UnpackedHypermediaId
  document: HMDocument
  callId: string
}) {
  const navigate = useNavigate()
  const appId = parentDocumentId(toolId)
  const appResource = useResource(appId)
  const app = appResource.data?.type === 'document' ? appResource.data.document : null
  const server = useAppServerUrl(appId ?? toolId, app ?? ({metadata: {}} as HMDocument))
  const call = useAppToolCall(server.serverUrl, callId)
  const run = call.data
  const toolName = document.metadata.name || toolId.path?.at(-1) || 'Tool'
  const versionId = run?.toolVersion ? {...toolId, version: run.toolVersion, latest: false} : null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <AgentSubpageHeader
        title={`Run of ${toolName}`}
        placeholder="Run"
        backLabel={`Back to ${toolName}`}
        onBack={() => navigate({key: 'document', id: toolId})}
      />
      <section className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-6 overflow-y-auto p-4">
        {run ? (
          <>
            <dl className="grid shrink-0 grid-cols-[auto_1fr] items-center gap-x-6 gap-y-3 rounded-lg border p-4 text-sm">
              <Detail label="Result">
                <CallOutcome call={run} />
              </Detail>
              <Detail label="Triggered by">
                <CallerName uid={run.caller} />
              </Detail>
              <Detail label="When">{new Date(run.createdAt).toLocaleString()}</Detail>
              <Detail label="Took">{formatDuration(run.durationMs ?? 0)}</Detail>
              <Detail label="Tool version">
                {versionId ? (
                  <button
                    type="button"
                    className="font-mono text-xs underline underline-offset-2"
                    onClick={() => navigate({key: 'document', id: versionId})}
                  >
                    {run.toolVersion!.slice(-12)}
                  </button>
                ) : (
                  <span className="text-muted-foreground">Not recorded</span>
                )}
              </Detail>
            </dl>
            <Block title="Input">
              <Json value={run.input} />
            </Block>
            <Block title={run.error ? 'Error' : 'Output'}>
              <CallOutput call={run} />
            </Block>
          </>
        ) : (
          <SizableText
            size="sm"
            color={call.isError ? undefined : 'muted'}
            className={call.isError ? 'text-destructive' : ''}
          >
            {call.isError ? appServerErrorMessage(call.error) : 'Loading…'}
          </SizableText>
        )}
      </section>
    </div>
  )
}

function Detail({label, children}: {label: string; children: ReactNode}) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  )
}

function Block({title, children}: {title: string; children: ReactNode}) {
  return (
    <div className="flex shrink-0 flex-col gap-2">
      <SizableText size="sm" weight="bold">
        {title}
      </SizableText>
      {children}
    </div>
  )
}
