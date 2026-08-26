// The Onyx-driven API console: call the universal-client RPC surface directly,
// with inputs edited by the standard schema-respecting value editor and both
// sides advisorily validated against the published seed-rpc-* schemas.
//
// The catalog is not hand-wired: it is derived from the `seed-rpc` union
// schema, whose variants each pin a method `key` and type its `input` and
// `output`. Browsing to a seed-rpc-* schema page in the tour renders a live
// call section for that method; the seed-rpc union page renders the full
// console with a method picker.
import {useMemo, useState} from 'react'
import {useUniversalAppContext} from '@shm/shared/routing'
import {Button} from '../button'
import {Spinner} from '../spinner'
import {cn} from '../utils'
import {OnyxDataEditor, seedValue} from './onyx-data-editor'
import {ONYX_SCHEMAS, refToName, validate, type OnyxSchema} from './onyx-engine'

export type RpcMethod = {
  /** The schema basename, e.g. `seed-rpc-search`. */
  slug: string
  /** The universal-client request key, e.g. `Search`. */
  key: string
  description?: string
  input: OnyxSchema
  output: OnyxSchema
}

/** The RPC catalog, derived from the `seed-rpc` union schema. */
export function rpcMethods(): RpcMethod[] {
  const union = ONYX_SCHEMAS['seed-rpc']
  if (!union?.anyOf) return []
  const methods: RpcMethod[] = []
  for (const variant of union.anyOf) {
    if (!variant.ref) continue
    const slug = refToName(variant.ref)
    const schema = ONYX_SCHEMAS[slug]
    const key = schema?.properties?.key?.enum?.[0]
    if (typeof key !== 'string' || !schema.properties?.input || !schema.properties?.output) continue
    methods.push({
      slug,
      key,
      description: schema.description,
      input: schema.properties.input,
      output: schema.properties.output,
    })
  }
  return methods.sort((a, b) => a.key.localeCompare(b.key))
}

/** The rpcMethod for one seed-rpc-* schema slug, if it is one. */
export function rpcMethodForSlug(slug: string): RpcMethod | undefined {
  return rpcMethods().find((m) => m.slug === slug)
}

type CallState =
  | {phase: 'idle'}
  | {phase: 'running'}
  | {phase: 'done'; data: unknown; ms: number}
  | {phase: 'error'; message: string; ms: number}

/** Live call panel for one RPC method: schema-driven input, invoke, validated output. */
export function RpcCallPanel({method}: {method: RpcMethod}) {
  const {universalClient} = useUniversalAppContext()
  const [value, setValue] = useState<unknown>(() => seedValue(method.input, ONYX_SCHEMAS))
  const [call, setCall] = useState<CallState>({phase: 'idle'})

  const inputWarnings = useMemo(() => validate(method.input, value, '$', {}, ONYX_SCHEMAS), [method.input, value])
  const outputWarnings = useMemo(
    () => (call.phase === 'done' ? validate(method.output, call.data, '$', {}, ONYX_SCHEMAS) : []),
    [method.output, call],
  )

  const run = async () => {
    setCall({phase: 'running'})
    const started = Date.now()
    try {
      const data = await universalClient.request(method.key as any, value as any)
      setCall({phase: 'done', data, ms: Date.now() - started})
    } catch (e) {
      setCall({phase: 'error', message: e instanceof Error ? e.message : String(e), ms: Date.now() - started})
    }
  }

  return (
    <div className="flex flex-col gap-4" data-testid={`rpc-call-${method.key}`}>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-foreground text-sm font-semibold">Input</span>
            <span className={cn('text-xs', inputWarnings.length ? 'text-destructive' : 'text-green-600')}>
              {inputWarnings.length ? `${inputWarnings.length} issue${inputWarnings.length > 1 ? 's' : ''}` : 'valid'}
            </span>
          </div>
          <OnyxDataEditor schema={method.input} value={value} onValue={setValue} registry={ONYX_SCHEMAS} />
          {inputWarnings.length > 0 && (
            <ul className="text-destructive list-disc pl-4 text-xs">
              {inputWarnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          <div>
            <Button size="sm" onClick={run} disabled={call.phase === 'running'}>
              {call.phase === 'running' ? <Spinner className="size-3" /> : null}
              Run {method.key}
            </Button>
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-foreground text-sm font-semibold">Response</span>
            {call.phase === 'done' && (
              <span className={cn('text-xs', outputWarnings.length ? 'text-amber-600' : 'text-green-600')}>
                {outputWarnings.length
                  ? `${outputWarnings.length} schema warning${outputWarnings.length > 1 ? 's' : ''} · ${call.ms}ms`
                  : `✓ matches schema · ${call.ms}ms`}
              </span>
            )}
            {call.phase === 'error' && <span className="text-destructive text-xs">failed · {call.ms}ms</span>}
          </div>
          {call.phase === 'idle' && (
            <p className="text-muted-foreground text-sm">Run the method to see its response, validated live.</p>
          )}
          {call.phase === 'running' && <Spinner />}
          {call.phase === 'error' && (
            <pre className="text-destructive overflow-x-auto rounded-md border border-red-300 bg-red-50 p-2 text-xs whitespace-pre-wrap dark:border-red-700 dark:bg-red-950">
              {call.message}
            </pre>
          )}
          {call.phase === 'done' && (
            <>
              {outputWarnings.length > 0 && (
                <ul className="list-disc pl-4 text-xs text-amber-600">
                  {outputWarnings.slice(0, 12).map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                  {outputWarnings.length > 12 && <li>… {outputWarnings.length - 12} more</li>}
                </ul>
              )}
              <pre className="bg-muted max-h-96 overflow-auto rounded-md p-2 font-mono text-xs">
                {JSON.stringify(call.data, (_k, v) => (v === undefined ? null : v), 2) ?? 'null'}
              </pre>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** The full console: a method picker driving a call panel. */
export function OnyxRpcConsole({initialKey}: {initialKey?: string}) {
  const methods = useMemo(rpcMethods, [])
  const [selectedKey, setSelectedKey] = useState<string | null>(initialKey ?? methods[0]?.key ?? null)
  const method = methods.find((m) => m.key === selectedKey)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1">
        {methods.map((m) => (
          <button
            key={m.key}
            className={cn(
              'rounded px-2 py-0.5 font-mono text-xs',
              m.key === selectedKey ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-accent',
            )}
            onClick={() => setSelectedKey(m.key)}
          >
            {m.key}
          </button>
        ))}
      </div>
      {method && (
        <>
          {method.description && <p className="text-muted-foreground text-sm">{method.description}</p>}
          <RpcCallPanel key={method.key} method={method} />
        </>
      )}
    </div>
  )
}
