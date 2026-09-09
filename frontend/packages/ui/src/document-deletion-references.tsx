import {useEffect, useState} from 'react'
import {useUniversalClient} from '@shm/shared/routing'
import {DeletionDocumentList, type DeleteDocumentDialogItem} from './deletion-document-list'
import {hmId, unpackHmId} from '@shm/shared/utils/entity-id-url'

/** Informational, best-effort citation impact for the exact documents approved for deletion. */
export function DocumentDeletionReferences({documentIds}: {documentIds: string[]}) {
  const client = useUniversalClient()
  const scope = JSON.stringify(Array.from(new Set(documentIds)).sort())
  const [result, setResult] = useState<{
    scope: string
    sources: DeleteDocumentDialogItem[]
    failed: boolean
  } | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    const ids: string[] = JSON.parse(scope)
    const deleting = new Set(
      ids.map((id) => {
        const parsed = unpackHmId(id)
        return parsed ? hmId(parsed.uid, {path: parsed.path}).id : id
      }),
    )
    async function check() {
      const sources = new Set<string>()
      let failed = false
      // Serialize requests: citation lookups can be expensive for the daemon.
      for (const id of Array.from(deleting)) {
        if (controller.signal.aborted) return
        try {
          const targetId = unpackHmId(id)
          if (!targetId) throw new Error('Invalid deletion target')
          const parentId = targetId.path?.length ? hmId(targetId.uid, {path: targetId.path.slice(0, -1)}).id : null
          const response = await client.request('ListCitations', {targetId}, {signal: controller.signal})
          for (const citation of response.citations) {
            const source = citation.sourceDocument || citation.source
            const parsed = unpackHmId(source)
            const canonical = parsed ? hmId(parsed.uid, {path: parsed.path}).id : source
            if (canonical && canonical !== parentId && !deleting.has(canonical)) sources.add(canonical)
          }
        } catch {
          failed = true
        }
      }
      const documents: DeleteDocumentDialogItem[] = []
      for (const source of Array.from(sources).sort()) {
        if (controller.signal.aborted) return
        const id = unpackHmId(source)
        let title = id ? id.path?.[id.path.length - 1] || 'Home document' : source
        if (id) {
          try {
            const resource = await client.request('Resource', id, {signal: controller.signal})
            if (resource.type === 'document') title = resource.document.metadata.name || title
          } catch {
            // Missing metadata must not hide a known reference or turn it into a citation lookup failure.
          }
        }
        documents.push({key: source, title, path: id?.path, href: id ? source : undefined})
      }
      if (!controller.signal.aborted) setResult({scope, sources: documents, failed})
    }
    void check()
    return () => controller.abort()
  }, [client, scope])

  const current = result?.scope === scope ? result : null
  return (
    <section aria-label="Known references" className="flex flex-col gap-2 text-sm">
      <p className="text-muted-foreground">
        References from other documents will break when these documents are deleted. This check only includes known,
        indexed references and may be incomplete.
      </p>
      {!current ? (
        <p role="status">Checking known references…</p>
      ) : (
        <>
          {current.failed && <p role="status">Could not check all known references. Other links may also break.</p>}
          {current.sources.length ? (
            <DeletionDocumentList documents={current.sources} label={`Known references (${current.sources.length})`} />
          ) : !current.failed ? (
            <p>No known references found outside the documents being deleted and their direct parents.</p>
          ) : null}
        </>
      )}
    </section>
  )
}
