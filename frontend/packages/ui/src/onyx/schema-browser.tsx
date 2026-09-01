// The schema browser, shared by desktop and web. Two homes:
//   - embedded in a defining document's Schema tool tab (`<doc URL>/:schema`) —
//     no header of its own; the schema actions live in the document's regular
//     options menu (see useSchemaMenuItems);
//   - the standalone bare-CID page (`/hm/schema/<cid>`) for schemas with no
//     defining document, which keeps a small header with New + options.
// Type links go to the type's own DOCUMENT wherever one exists (hm:// refs and
// bundled names); only raw ipfs:// refs fall back to the bare-CID page.
// Bundled API-method schemas also get their live call panel here.
import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import type {NavRoute} from '@shm/shared/routes'
import {useResource} from '@shm/shared/models/entity'
import {FileCode2, Layers, Plus, SearchCode} from 'lucide-react'
import {Button} from '../button'
import {Container} from '../container'
import {OptionsDropdown} from '../options-dropdown'
import {Tooltip} from '../tooltip'
import {extendSchemaRoute, META_SCHEMA_CID, newInstanceRoute} from './blob-menu-items'
import {nameForCid, nameToUrl, ONYX_SCHEMAS, schemaCid} from './onyx-engine'
import {OnyxNavContext, OnyxSchemaByCid} from './onyx-explorer'
import {OnyxRpcConsole, RpcCallPanel, rpcMethodForSlug} from './onyx-rpc-console'
import {useOnyxSchemaRegistry} from './onyx-schema-registry-cid'
import {schemaDefinitionCid} from './schema-document'

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
  cid: cidProp,
  docId,
  navigate,
  openUrl,
  embedded,
}: {
  /** The schema blob CID. Optional when `docId` is given. */
  cid?: string
  /** The document that DEFINES the schema; its `schemaDefinition` names the CID. */
  docId?: UnpackedHypermediaId
  navigate: (route: NavRoute) => void
  openUrl: (url: string, newWindow?: boolean) => void
  /** Rendered inside a document's Schema tool tab: no page container and no header of its own —
   * the tab names the view and the document's options menu carries the schema actions. */
  embedded?: boolean
}) {
  // Reached via `<doc URL>/:schema`: resolve the defining doc's schemaDefinition.
  const docResource = useResource(cidProp ? null : docId)
  const docMetadata = docResource.data?.type === 'document' ? docResource.data.document?.metadata : undefined
  const cid = cidProp || schemaDefinitionCid(docMetadata) || ''
  const bundled = cid ? nameForCid(cid) : undefined
  const {byCid} = useOnyxSchemaRegistry(bundled || !cid ? [] : [cid])
  const schema = !cid ? undefined : bundled ? ONYX_SCHEMAS[bundled] : byCid[cid]
  const typeName = bundled || 'this schema'
  // A union has no single seed shape, so it can't start a blob.
  const canCreate = !!schema && !schema.anyOf && !schema.$type

  const goToCid = (c: string) => navigate({key: 'schema', cid: c})
  // A linked type's home is its published DOCUMENT, not the schema CID page: a
  // bundled slug resolves to its canonical hm:// doc, and hm:// refs open as-is.
  // Only a raw ipfs:// ref — a schema with no known document — falls back to
  // the bare-CID browser.
  const nav = (slug: string) => {
    if (!schemaCid(slug)) return
    const url = nameToUrl(slug)
    if (url) return openUrl(url)
    const c = schemaCid(slug)
    if (c) goToCid(c)
  }
  const openRef = (ref: string) => {
    if (ref.startsWith('hm://')) return openUrl(ref)
    const ipfs = /^ipfs:\/\/([^/]+)/.exec(ref)
    if (ipfs) return goToCid(ipfs[1]!)
    if (schemaCid(ref)) return nav(ref)
    openUrl(ref)
  }
  const body = (
    <div className={embedded ? 'flex flex-col gap-4' : 'mx-auto flex max-w-3xl flex-col gap-4'}>
      {!embedded && (
        <header className="flex items-center justify-between gap-3 border-b pb-3" data-testid="schema-browser-header">
          <span className="bg-muted inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium">
            <FileCode2 className="size-3.5" /> Schema
          </span>
          <div className="flex items-center gap-2">
            {canCreate && (
              <Tooltip
                content={`Start a new IPFS blob that follows ${typeName} — the draft is pre-filled with this schema`}
              >
                <Button size="sm" data-testid="schema-browser-new" onClick={() => navigate(newInstanceRoute(cid))}>
                  <Plus className="mr-1 size-4" /> New {typeName}
                </Button>
              </Tooltip>
            )}
            {cid && (
              <OptionsDropdown
                align="end"
                ariaLabel="Schema options"
                menuItems={[
                  {
                    key: 'inspect',
                    label: 'Inspect',
                    icon: <SearchCode className="size-4" />,
                    onClick: () => navigate({key: 'inspect-ipfs', ipfsPath: cid}),
                  },
                  canCreate
                    ? {
                        key: 'new-instance',
                        label: `New ${typeName}`,
                        icon: <Plus className="size-4" />,
                        onClick: () => navigate(newInstanceRoute(cid)),
                      }
                    : null,
                  {
                    key: 'new-schema',
                    label: 'New Schema',
                    icon: <FileCode2 className="size-4" />,
                    onClick: () => navigate(newInstanceRoute(META_SCHEMA_CID)),
                  },
                  canCreate
                    ? {
                        key: 'extend-schema',
                        label: 'Extend Schema',
                        icon: <Layers className="size-4" />,
                        onClick: () => navigate(extendSchemaRoute(cid)),
                      }
                    : null,
                ]}
              />
            )}
          </div>
        </header>
      )}
      <OnyxNavContext.Provider value={{openRef}}>
        {cid ? (
          <>
            <OnyxSchemaByCid key={cid} cid={cid} nav={nav} hideIdentity={embedded} />
            {bundled && <RpcSection slug={bundled} />}
          </>
        ) : (
          <div className="text-muted-foreground p-4 text-sm" data-testid="schema-browser-resolving">
            {docResource.isLoading
              ? 'Resolving the schema this document defines…'
              : 'This document does not define a schema.'}
          </div>
        )}
      </OnyxNavContext.Provider>
    </div>
  )
  if (embedded) return body
  return <Container className="py-6">{body}</Container>
}
