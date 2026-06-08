import {
  HMDocument,
  HMMetadata,
  HMMetadataPayload,
  HMResourceVisibility,
  UnpackedHypermediaId,
} from '@seed-hypermedia/client/hm-types'
import {abbreviateUid, useRouteLink} from '@shm/shared'
import type {NavRoute} from '@shm/shared/routes'
import {useAccount} from '@shm/shared/models/entity'
import {getVersionHeads} from '@shm/shared/utils/entity-id-url'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {useMemo} from 'react'
import {Container} from './container'
import {DocumentDate} from './document-date'
import {useHighlighter} from './highlight-context'
import {HMIcon} from './hm-icon'
import {Home} from './icons'
import {getContextualProfileRoute} from './inline-descriptor'
import {MergedBadge} from './merged-badge'
import {PrivateBadge} from './private-badge'
import {Spinner} from './spinner'
import {SizableText} from './text'
import {Tooltip} from './tooltip'

export type AuthorPayload = HMMetadataPayload

export type BreadcrumbEntry =
  | {
      id: UnpackedHypermediaId
      metadata: HMMetadata
      isLoading?: boolean
      isNotFound?: boolean
      isTombstone?: boolean
      isError?: boolean
      /** Set on the last crumb when the current page is an unpublished local draft. */
      isUnpublishedDraft?: boolean
      /** Local draft route target for unpublished breadcrumb sections. */
      draftId?: string
      fallbackName?: string
    }
  | {label: string}

export function DocumentHeader({
  docId,
  docMetadata,
  authors = [],
  updateTime = null,
  breadcrumbs,
  siteUrl,
  documentTools,
  visibility,
  version,
  showTitle = true,
  children,
}: {
  docId: UnpackedHypermediaId | null
  docMetadata: HMMetadata | null
  authors: AuthorPayload[]
  updateTime: HMDocument['updateTime'] | null
  breadcrumbs?: BreadcrumbEntry[]
  siteUrl?: string
  documentTools?: React.ReactNode
  visibility?: HMResourceVisibility
  version?: HMDocument['version'] | null
  showTitle?: boolean
  children?: React.ReactNode
}) {
  const hasCover = useMemo(() => !!docMetadata?.cover, [docMetadata])
  const hasIcon = useMemo(() => !!docMetadata?.icon, [docMetadata])
  const isHomeDoc = !docId?.path?.length
  const highlighter = useHighlighter()
  const isPrivate = visibility === 'PRIVATE'
  const headCount = getVersionHeads(version).length
  const displayAuthors = useMemo(() => {
    const seen = new Set<string>()
    return authors.filter((author) => {
      const key = author.id.id
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [authors])

  return (
    <Container
      className="dark:bg-background relative w-full rounded-lg bg-white"
      style={{
        marginTop: hasCover ? -40 : 0,
        paddingTop: !hasCover ? 60 : 24,
      }}
    >
      <div className="flex flex-col gap-4">
        {!isHomeDoc && docId && hasIcon ? (
          <div
            className="flex"
            style={{
              marginTop: hasCover ? -80 : 0,
            }}
          >
            <HMIcon size={100} id={docId} name={docMetadata?.name} icon={docMetadata?.icon} />
          </div>
        ) : null}
        {breadcrumbs && breadcrumbs.length > 0 ? <Breadcrumbs breadcrumbs={breadcrumbs} /> : null}
        {(isPrivate || headCount > 1) && (
          <div className="flex flex-wrap items-center gap-2">
            {isPrivate && <PrivateBadge />}
            {headCount > 1 && <MergedBadge count={headCount} />}
          </div>
        )}
        {children ? (
          children
        ) : (
          <>
            {showTitle && (
              <SizableText size="5xl" weight="bold" {...highlighter(docId)}>
                {isHomeDoc ? 'Home' : docMetadata?.name}
              </SizableText>
            )}
            {docMetadata?.summary ? (
              <span className="font-body text-muted-foreground text-xl">{docMetadata?.summary}</span>
            ) : null}
          </>
        )}
        <div className="border-border flex flex-col gap-2 border-b pb-4">
          {siteUrl ? <SiteURLButton siteUrl={siteUrl} /> : null}
          <div className="flex flex-1 items-center justify-between gap-3">
            <div className="flex flex-1 flex-wrap items-center gap-3">
              {displayAuthors.length ? (
                <>
                  <p className="text-sm font-bold">
                    {displayAuthors.flatMap((a, index) => {
                      return [
                        <AuthorLink id={a.id} key={a.id.id} siteUid={docId?.uid} />,
                        index !== displayAuthors.length - 1 ? (
                          index === displayAuthors.length - 2 ? (
                            <SizableText key={`${a.id.id}-and`} size="xs" weight="bold">
                              {' & '}
                            </SizableText>
                          ) : (
                            <SizableText size="xs" key={`${a.id.id}-comma`} weight="bold">
                              {', '}
                            </SizableText>
                          )
                        ) : null,
                      ]
                    })}
                  </p>
                  <div className="bg-border h-6 w-px" />
                </>
              ) : null}
              {updateTime ? <DocumentDate metadata={docMetadata || undefined} updateTime={updateTime} /> : null}
            </div>
          </div>
        </div>
      </div>
      {documentTools}
    </Container>
  )
}

/** Renders a clickable author name with a spinner while the account is loading. */
function AuthorLink({id, siteUid}: {id: UnpackedHypermediaId; siteUid?: string}) {
  const currentRoute = useNavRoute()
  const account = useAccount(id.uid, {subscribe: true})
  const resolvedName = account.data?.metadata?.name
  const linkProps = useRouteLink(getContextualProfileRoute(currentRoute, id, siteUid))
  return (
    <a
      {...linkProps}
      className={`no-underline underline-offset-4 hover:underline ${resolvedName ? '' : 'text-muted-foreground'}`}
    >
      {resolvedName || abbreviateUid(id.uid)}
      {!resolvedName ? (
        <span className="ml-1">
          <Spinner size="small" />
        </span>
      ) : null}
    </a>
  )
}

/**
 * Renders document breadcrumbs when there is at least one navigable item beyond the home/root crumb.
 */
export function Breadcrumbs({breadcrumbs}: {breadcrumbs: BreadcrumbEntry[]}) {
  if (breadcrumbs.length <= 1) return null

  const [first, ...rest] = breadcrumbs
  const lastIndex = breadcrumbs.length - 1

  return (
    <nav aria-label="Breadcrumb" className="text-muted-foreground flex flex-1 items-center">
      <ol className="flex min-w-0 flex-1 items-center gap-2">
        {first && 'id' in first ? (
          <li className="flex min-w-0 items-center">
            <HomeBreadcrumb crumb={first} isCurrent={lastIndex === 0} />
          </li>
        ) : null}
        {rest.map((crumb, i) => {
          const index = i + 1
          const key = 'id' in crumb ? crumb.id.id : `label-${i}`
          const isCurrent = index === lastIndex
          return (
            <li key={key} className="flex min-w-0 items-center gap-2">
              <SizableText aria-hidden="true" color="muted" size="xs">
                {'>'}
              </SizableText>
              {'id' in crumb ? (
                <BreadcrumbLink crumb={crumb} isCurrent={isCurrent} />
              ) : (
                <span
                  aria-current={isCurrent ? 'page' : undefined}
                  className="min-w-0 truncate text-xs whitespace-nowrap"
                >
                  {crumb.label}
                </span>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

type DocumentBreadcrumbEntry = Extract<BreadcrumbEntry, {id: any}>

function HomeBreadcrumb({crumb, isCurrent}: {crumb: DocumentBreadcrumbEntry; isCurrent: boolean}) {
  const linkProps = useRouteLink({key: 'document', id: crumb.id})
  if (isCurrent) {
    return (
      <span aria-current="page" className="text-muted-foreground flex items-center gap-1">
        <Home className="size-3" />
      </span>
    )
  }
  return (
    <a {...linkProps} className="text-muted-foreground flex items-center gap-1 no-underline hover:underline">
      <Home className="size-3" />
    </a>
  )
}

function BreadcrumbLink({crumb, isCurrent}: {crumb: DocumentBreadcrumbEntry; isCurrent: boolean}) {
  const route: NavRoute = crumb.draftId ? {key: 'draft', id: crumb.draftId} : {key: 'document', id: crumb.id}
  const linkProps = useRouteLink(route)
  const title = crumb.metadata?.name
  const fallbackName = crumb.fallbackName || crumb.id.path?.at(-1) || crumb.id.uid.slice(0, 8)
  const displayName = title || fallbackName

  const renderText = (className: string, label = displayName) =>
    isCurrent ? (
      <span aria-current="page" className={className}>
        {label}
      </span>
    ) : (
      <a {...linkProps} className={`${className} no-underline hover:underline`}>
        {label}
      </a>
    )

  if (crumb.isLoading) {
    const content = (
      <>
        {title || 'Loading…'}
        <Spinner size="small" />
      </>
    )
    const className = 'text-muted-foreground flex items-center gap-1 text-xs whitespace-nowrap'
    if (isCurrent) {
      return (
        <span aria-current="page" className={className}>
          {content}
        </span>
      )
    }
    return (
      <a {...linkProps} className={`${className} no-underline hover:underline`}>
        {content}
      </a>
    )
  }

  if (crumb.isTombstone) {
    return (
      <Tooltip content="This document has been deleted">
        {renderText('min-w-0 truncate text-xs whitespace-nowrap text-red-500')}
      </Tooltip>
    )
  }

  if (crumb.isUnpublishedDraft) {
    return (
      <Tooltip content="This document is a draft and has not been published yet — its URL is private to you.">
        {renderText('text-muted-foreground min-w-0 truncate text-xs whitespace-nowrap italic')}
      </Tooltip>
    )
  }

  if (crumb.isNotFound) {
    return (
      <Tooltip content="Document not found on the network">
        {renderText('min-w-0 truncate text-xs whitespace-nowrap text-red-500')}
      </Tooltip>
    )
  }

  if (crumb.isError) {
    return (
      <Tooltip content="Failed to load this document">
        {renderText('min-w-0 truncate text-xs whitespace-nowrap text-red-500')}
      </Tooltip>
    )
  }

  if (!crumb.metadata?.name) {
    return renderText('text-muted-foreground min-w-0 truncate text-xs whitespace-nowrap')
  }

  return renderText('min-w-0 truncate overflow-hidden text-xs whitespace-nowrap', crumb.metadata.name)
}

function SiteURLButton({siteUrl, onSiteUrlClick}: {siteUrl: string; onSiteUrlClick?: (url: string) => void}) {
  return (
    <SizableText
      size="sm"
      className="no-underline underline-offset-4 hover:underline"
      onClick={() => onSiteUrlClick?.(siteUrl)}
    >
      {siteUrl}
    </SizableText>
  )
}
