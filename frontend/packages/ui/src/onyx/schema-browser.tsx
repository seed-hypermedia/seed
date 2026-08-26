// The full-page schema browser (`/hm/schema/<cid>`), shared by desktop and web.
// Hosts OnyxSchemaByCid and turns its navigation into routes: a bundled schema
// name → its CID's page; an `ipfs://` schema → that CID's page; an `hm://` type
// document → open the document. So a click on any reference keeps browsing.
import type {NavRoute} from '@shm/shared/routes'
import {ArrowLeft, FileCode2} from 'lucide-react'
import {Button} from '../button'
import {OnyxNavContext, OnyxSchemaByCid} from './onyx-explorer'
import {schemaCid} from './onyx-engine'
import {Container} from '../container'

export function OnyxSchemaBrowserPage({
  cid,
  navigate,
  openUrl,
}: {
  cid: string
  navigate: (route: NavRoute) => void
  openUrl: (url: string, newWindow?: boolean) => void
}) {
  const goToCid = (c: string) => navigate({key: 'schema', cid: c})
  const nav = (slug: string) => {
    const c = schemaCid(slug)
    if (c) goToCid(c)
  }
  const openRef = (ref: string) => {
    const ipfs = /^ipfs:\/\/([^/]+)/.exec(ref)
    if (ipfs) return goToCid(ipfs[1]!)
    const bundled = schemaCid(ref)
    if (bundled) return goToCid(bundled)
    openUrl(ref)
  }
  return (
    <Container className="py-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <div className="text-muted-foreground flex items-center gap-2 text-xs">
          <FileCode2 className="size-4" />
          <span>Schema</span>
          <span>·</span>
          <button type="button" className="hover:underline" onClick={() => navigate({key: 'onyx'})}>
            browse the library
          </button>
        </div>
        <OnyxNavContext.Provider value={{openRef}}>
          <OnyxSchemaByCid key={cid} cid={cid} nav={nav} />
        </OnyxNavContext.Provider>
        <div>
          <Button variant="ghost" size="sm" onClick={() => window.history.back()}>
            <ArrowLeft className="mr-1 size-4" /> Back
          </Button>
        </div>
      </div>
    </Container>
  )
}
