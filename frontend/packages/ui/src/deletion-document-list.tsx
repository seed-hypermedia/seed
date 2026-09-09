import React from 'react'
import {Text} from './text'

/** A document title, path, and optional link displayed in a deletion review. */
export type DeleteDocumentDialogItem = {
  key: string
  title: string
  path?: string[] | null
  href?: string
}

function DeletionListItem({item}: {item: DeleteDocumentDialogItem}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 py-3" data-testid="delete-document-child-item">
      {item.href ? (
        <a
          className="text-primary truncate text-sm font-medium hover:underline"
          href={item.href}
          target="_blank"
          rel="noreferrer"
        >
          {item.title}
        </a>
      ) : (
        <Text className="truncate text-sm font-medium">{item.title}</Text>
      )}
      <Text className="text-muted-foreground truncate text-xs">{item.path?.join('/') || 'Unknown path'}</Text>
    </div>
  )
}

/** Expandable, bounded list of document titles and paths for destructive confirmations. */
export function DeletionDocumentList({documents, label}: {documents: DeleteDocumentDialogItem[]; label: string}) {
  const [showChildDocuments, setShowChildDocuments] = React.useState(false)
  const childDocumentListId = React.useId()
  return (
    <div
      className="border-destructive/20 bg-destructive/[0.03] overflow-hidden rounded-lg border"
      data-testid="delete-document-child-section"
    >
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <Text className="text-base font-semibold">{label}</Text>
        <button
          type="button"
          aria-controls={showChildDocuments ? childDocumentListId : undefined}
          aria-expanded={showChildDocuments}
          className="text-primary hover:text-primary/80 focus-visible:ring-ring/50 rounded-sm text-sm font-medium transition-colors outline-none focus-visible:ring-[3px]"
          onClick={() => setShowChildDocuments((visible) => !visible)}
        >
          {showChildDocuments ? 'Hide' : 'Show'}
        </button>
      </div>
      {showChildDocuments ? (
        <div
          id={childDocumentListId}
          className="border-border max-h-56 overflow-y-auto border-t px-4 py-3"
          data-testid="delete-document-child-list"
        >
          <div className="flex flex-col divide-y">
            {documents.map((item) => (
              <DeletionListItem key={item.key} item={item} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
