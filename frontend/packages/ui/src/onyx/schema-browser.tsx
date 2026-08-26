// The full-page schema browser (`/hm/schema/<cid>`), shared by desktop and web.
// Hosts OnyxSchemaByCid and turns its navigation into routes: a bundled schema
// name → its CID's page; an `ipfs://` schema → that CID's page; an `hm://` type
// document → open the document. The header's New button starts a blob draft
// that follows this schema (the draft page pre-fills its `schema` link).
// Bundled API-method schemas also get their live call panel here.
import type {NavRoute} from '@shm/shared/routes'
import {FileCode2, Plus} from 'lucide-react'
import {Button} from '../button'
import {Container} from '../container'
import {Tooltip} from '../tooltip'
import {newInstanceRoute} from './blob-menu-items'
import {nameForCid, ONYX_SCHEMAS, schemaCid} from './onyx-engine'
import {OnyxNavContext, OnyxSchemaByCid} from './onyx-explorer'
import {OnyxRpcConsole, RpcCallPanel, rpcMethodForSlug} from './onyx-rpc-console'
import {useOnyxSchemaRegistry} from './onyx-schema-registry-cid'

/** Under a bundled API schema, the live call panel (the union page is the whole console). */
function RpcSection({slug}: {slug: string}) {
  if (slug === 'seed-rpc')
    return (
      <section className="border-border mt-6 border-t pt-4">
        <h2 className="mb-2 text-sm font-semibold">API console · call any method of this union</h2>
        <OnyxRpcConsole />
      </section>
    )
  const method = rpcMethodForSlug(slug)
  if (!method) return null
  return (
    <section className="border-border mt-6 border-t pt-4">
      <h2 className="mb-2 text-sm font-semibold">Call {method.key} · live, against this app's API</h2>
      <RpcCallPanel key={slug} method={method} />
    </section>
  )
}

export function OnyxSchemaBrowserPage({
  cid,
  navigate,
  openUrl,
}: {
  cid: string
  navigate: (route: NavRoute) => void
  openUrl: (url: string, newWindow?: boolean) => void
}) {
  const bundled = nameForCid(cid)
  const {byCid} = useOnyxSchemaRegistry(bundled ? [] : [cid])
  const schema = bundled ? ONYX_SCHEMAS[bundled] : byCid[cid]
  const typeName = (typeof schema?.name === 'string' && schema.name) || bundled || 'this schema'
  // A union has no single seed shape, so it can't start a blob.
  const canCreate = !!schema && !schema.anyOf && !schema.$type

  const goToCid = (c: string) => navigate({key: 'schema', cid: c})
  const nav = (slug: string) => {
    const c = schemaCid(slug)
    if (c) goToCid(c)
  }
  const openRef = (ref: string) => {
    const ipfs = /^ipfs:\/\/([^/]+)/.exec(ref)
    if (ipfs) return goToCid(ipfs[1]!)
    const bundledCid = schemaCid(ref)
    if (bundledCid) return goToCid(bundledCid)
    openUrl(ref)
  }
  return (
    <Container className="py-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <header className="flex items-center justify-between gap-3 border-b pb-3" data-testid="schema-browser-header">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <span className="bg-muted inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium">
              <FileCode2 className="size-3.5" /> Schema
            </span>
            <code className="text-muted-foreground truncate text-xs" title={`ipfs://${cid}`}>
              {cid}
            </code>
          </div>
          {canCreate && (
            <Tooltip
              content={`Start a new IPFS blob that follows ${typeName} — the draft is pre-filled with this schema`}
            >
              <Button size="sm" data-testid="schema-browser-new" onClick={() => navigate(newInstanceRoute(cid))}>
                <Plus className="mr-1 size-4" /> New {typeName}
              </Button>
            </Tooltip>
          )}
        </header>
        <OnyxNavContext.Provider value={{openRef}}>
          <OnyxSchemaByCid key={cid} cid={cid} nav={nav} />
          {bundled && <RpcSection slug={bundled} />}
        </OnyxNavContext.Provider>
      </div>
    </Container>
  )
}
