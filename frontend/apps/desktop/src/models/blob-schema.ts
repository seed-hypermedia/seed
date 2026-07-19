import {useSchemaRegistries} from '@shm/ui/blob-schema-registry'
import type {BlobSchema, SchemaRegistry} from '@shm/ui/blob-schema'
import {useMemo} from 'react'

/**
 * Single-root convenience over useSchemaRegistries (see that hook for the
 * fetch/convergence semantics): fetch one schema blob and its transitive ref
 * closure, exposing the root schema directly.
 */
export function useSchemaRegistry(schemaCid: string | undefined): {
  rootSchema: BlobSchema | undefined
  registry: SchemaRegistry
  isLoading: boolean
  isComplete: boolean
} {
  const seeds = useMemo(() => (schemaCid ? [schemaCid] : []), [schemaCid])
  const {registry, isLoading, isComplete} = useSchemaRegistries(seeds)
  return {
    rootSchema: schemaCid ? registry[schemaCid] : undefined,
    registry,
    isLoading,
    isComplete,
  }
}
