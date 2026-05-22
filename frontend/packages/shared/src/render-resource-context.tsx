import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {createContext, useContext, useMemo} from 'react'
import {packHmId} from './utils/entity-id-url'

/** Resource kinds that participate in embed-cycle detection. */
export type RenderResourceKind = 'document' | 'comment'

/** Resource currently being rendered for cycle detection. */
export type RenderResource = {
  kind: RenderResourceKind
  id: UnpackedHypermediaId
}

const RenderResourceStackContext = createContext<RenderResource[]>([])

/** Provides the current render-resource ancestry to descendants. */
export function RenderResourceProvider({
  resource,
  children,
}: {
  resource: RenderResource | null | undefined
  children: React.ReactNode
}) {
  const parentStack = useContext(RenderResourceStackContext)
  const value = useMemo(() => (resource?.id ? [...parentStack, resource] : parentStack), [parentStack, resource])
  return <RenderResourceStackContext.Provider value={value}>{children}</RenderResourceStackContext.Provider>
}

/** Returns the current render-resource ancestry stack. */
export function useRenderResourceStack(): RenderResource[] {
  return useContext(RenderResourceStackContext)
}

/** Returns whether rendering `candidate` would create a blocked embed cycle. */
export function shouldBlockEmbeddedResource(ancestors: RenderResource[], candidate: RenderResource): boolean {
  const candidateBaseKey = getBaseResourceKey(candidate)
  const candidateExactKey = getExactResourceKey(candidate)

  return ancestors.some((ancestor) => {
    if (ancestor.kind !== candidate.kind) return false
    if (getExactResourceKey(ancestor) === candidateExactKey) return true
    if (candidate.kind === 'comment' && getBaseResourceKey(ancestor) === candidateBaseKey) return true
    if (candidate.id.latest && getBaseResourceKey(ancestor) === candidateBaseKey) return true
    return false
  })
}

/** Returns a stable, version-agnostic identity key for a resource. */
export function getBaseResourceKey(resource: RenderResource): string {
  return `${resource.kind}:${resource.id.id}`
}

/** Returns a stable, fully-qualified identity key for a resource version/ref. */
export function getExactResourceKey(resource: RenderResource): string {
  return `${resource.kind}:${packHmId({
    ...resource.id,
    hostname: null,
    scheme: null,
  })}`
}
