import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {hmId, useRouteLink} from '@shm/shared'
import {groupDocumentConnections, type DocumentConnection, type DocumentConnectionSource} from '@shm/shared/connections'
import {useCitations, useResource} from '@shm/shared/models/entity'
import {useReadOnlyViewer} from '@shm/shared/readonly-viewer-context'
import {formattedDate} from '@shm/shared/utils/date'
import {ArrowUpRight, ChevronDown, FileText} from 'lucide-react'
import {useId, useMemo, useState} from 'react'
import {AccountIdentity} from './account-avatar'
import {getBlockNodeById} from './blocks-content-utils'
import {Button} from './button'
import {ConnectionsGraph} from './connections-graph'
import {cn} from './utils'

/** Incoming backlinks grouped by source document, with source content loaded on expansion. */
export function ConnectionsPanel({docId, targetBlockId}: {docId: UnpackedHypermediaId; targetBlockId?: string}) {
  const citations = useCitations(docId)
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set())
  const groups = useMemo(
    () => groupDocumentConnections(docId, citations.data?.citations, targetBlockId),
    [docId, citations.data, targetBlockId],
  )
  const toggleDocument = (id: string) => {
    setExpandedIds((previous) => {
      const next = new Set(previous)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  return (
    <div className="bg-card flex min-h-full flex-col gap-4 p-4">
      <ConnectionsGraph docId={docId} groups={groups} expandedIds={expandedIds} onSelect={toggleDocument} />
      <p className="text-sm">Connections show where other documents or comments link to this document.</p>
      <h2 className="text-sm font-semibold">Related documents</h2>
      {citations.isInitialLoading ? (
        <p className="text-muted-foreground text-sm" role="status">
          Loading connections…
        </p>
      ) : citations.isError ? (
        <div role="alert">
          <p>Could not load connections.</p>
          <Button onClick={() => citations.refetch()}>Try again</Button>
        </div>
      ) : groups.length ? (
        <div className="divide-border border-border divide-y border-t">
          {groups.map((group) => (
            <ConnectionDocument
              key={group.id.id}
              group={group}
              expanded={expandedIds.has(group.id.id)}
              onToggle={() => toggleDocument(group.id.id)}
            />
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">No backlinks to this document yet.</p>
      )}
    </div>
  )
}

function ConnectionDocument({
  group,
  expanded,
  onToggle,
}: {
  group: DocumentConnection
  expanded: boolean
  onToggle: () => void
}) {
  const contentId = useId()
  const resource = useResource(group.id)
  const document = resource.data?.type === 'document' ? resource.data.document : undefined
  return (
    <section className="py-3">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={contentId}
        onClick={onToggle}
        className="hover:bg-muted focus-visible:ring-ring flex w-full items-start gap-3 rounded-md p-1 text-left transition-colors duration-(--duration-normal) focus-visible:ring-2"
      >
        <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded">
          <FileText className="size-4" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-sm font-semibold">
            {document?.metadata.name || (resource.isInitialLoading ? 'Loading document…' : 'Untitled document')}
          </span>
          <span className="text-muted-foreground text-xs">
            {group.sources[0]?.citation.sourceBlob?.createTime && (
              <>{formattedDate(group.sources[0].citation.sourceBlob.createTime)} · </>
            )}
            {group.sources.length} {group.sources.length === 1 ? 'link' : 'links'}
          </span>
        </span>
        <ChevronDown
          className={cn(
            'size-4 shrink-0 transition-transform duration-(--duration-normal) ease-(--ease-out-smooth) motion-reduce:transition-none',
            expanded && 'rotate-180',
          )}
        />
      </button>
      <div
        id={contentId}
        className={cn(
          'grid transition-[grid-template-rows] duration-(--duration-normal) ease-(--ease-out-smooth) motion-reduce:transition-none',
          expanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="min-h-0 overflow-hidden">
          {expanded && (
            <div className="flex flex-col gap-3 pt-3 pl-10">
              {group.sources.map((source) => (
                <ConnectionSource
                  key={JSON.stringify([source.id.id, source.id.blockRef])}
                  source={source}
                  documentId={group.id}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function ConnectionSource({source, documentId}: {source: DocumentConnectionSource; documentId: UnpackedHypermediaId}) {
  const resource = useResource(source.id)
  const author = useResource(source.citation.sourceBlob?.author ? hmId(source.citation.sourceBlob.author) : null)
  const metadata = author.data?.type === 'document' ? author.data.document.metadata : undefined
  const Viewer = useReadOnlyViewer()
  const comment = resource.data?.type === 'comment' ? resource.data.comment : undefined
  const content = resource.data?.type === 'document' ? resource.data.document.content : comment?.content
  const block = source.id.blockRef && content ? getBlockNodeById(content, source.id.blockRef) : undefined
  const blocks = block ? [block] : !source.id.blockRef && source.isComment ? content : undefined
  const link = useRouteLink(
    source.isComment
      ? {
          key: 'document',
          id: documentId,
          panel: {
            key: 'comments',
            id: documentId,
            openComment: comment?.id || [source.id.uid, ...(source.id.path || [])].join('/'),
            blockId: source.id.blockRef || undefined,
          },
        }
      : {key: 'document', id: source.id},
  )
  return (
    <div className="bg-muted flex min-w-0 flex-col gap-3 rounded-lg p-3">
      <div className="flex items-center justify-between gap-2">
        {source.citation.sourceBlob?.author && (
          <AccountIdentity
            id={hmId(source.citation.sourceBlob.author)}
            name={metadata?.name}
            icon={metadata?.icon}
            className="text-xs"
          />
        )}
        <a {...link} className="text-brand-4 ml-auto inline-flex shrink-0 items-center gap-1 text-xs font-semibold">
          Go to location <ArrowUpRight className="size-3" />
        </a>
      </div>
      {resource.isInitialLoading ? (
        <p className="text-muted-foreground text-sm" role="status">
          Loading mention…
        </p>
      ) : blocks?.length && Viewer ? (
        <Viewer
          className="is-comment"
          blocks={blocks}
          resourceId={source.id}
          resourceKind={source.isComment ? 'comment' : 'document'}
          textUnit={14}
          layoutUnit={16}
        />
      ) : (
        <p className="text-muted-foreground text-sm">
          This source item is unavailable. Open its location to view the document.
        </p>
      )}
    </div>
  )
}
