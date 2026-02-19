import {
  abbreviateUid,
  getMetadataName,
  HMDocument,
  HMMetadata,
  HMMetadataPayload,
  HMResourceVisibility,
  UnpackedHypermediaId,
  useRouteLink,
} from '@shm/shared'
import {useMemo} from 'react'
import {Container} from './container'
import {DocumentDate} from './document-date'
import {useHighlighter} from './highlight-context'
import {HMIcon} from './hm-icon'
import {Home} from './icons'
import {PrivateBadge} from './private-badge'
import {Spinner} from './spinner'
import {SizableText} from './text'
import {Tooltip} from './tooltip'

export type AuthorPayload = HMMetadataPayload & {
  isDiscovering?: boolean
}

export type BreadcrumbEntry =
  | {
      id: UnpackedHypermediaId
      metadata: HMMetadata
      isLoading?: boolean
      isNotFound?: boolean
      isTombstone?: boolean
      isError?: boolean
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
  showTitle = true,
}: {
  docId: UnpackedHypermediaId | null
  docMetadata: HMMetadata | null
  authors: AuthorPayload[]
  updateTime: HMDocument['updateTime'] | null
  breadcrumbs?: BreadcrumbEntry[]
  siteUrl?: string
  documentTools?: React.ReactNode
  visibility?: HMResourceVisibility
  showTitle?: boolean
}) {
  const hasCover = useMemo(() => !!docMetadata?.cover, [docMetadata])
  const hasIcon = useMemo(() => !!docMetadata?.icon, [docMetadata])
  const isHomeDoc = !docId?.path?.length
  const highlighter = useHighlighter()
  const isPrivate = visibility === 'PRIVATE'

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
        {isPrivate && <PrivateBadge />}
        {showTitle && (
          <SizableText size="4xl" weight="bold" {...highlighter(docId)}>
            {isHomeDoc ? 'Home' : docMetadata?.name}
          </SizableText>
        )}
        {docMetadata?.summary ? (
          <span className="font-body text-muted-foreground text-xl">{docMetadata?.summary}</span>
        ) : null}
        <div className="border-border flex flex-col gap-2 border-b pb-4">
          {siteUrl ? <SiteURLButton siteUrl={siteUrl} /> : null}
          <div className="flex flex-1 items-center justify-between gap-3">
            <div className="flex flex-1 flex-wrap items-center gap-3">
              {authors?.length ? (
                <>
                  <p className="text-sm font-bold">
                    {authors.flatMap((a, index) => {
                      return [
                        a.isDiscovering ? (
                          <span className="text-muted-foreground">
                            {abbreviateUid(a.id.uid)}
                            <span className="ml-1">
                              <Spinner size="small" />
                            </span>
                          </span>
                        ) : (
                          <AuthorLink name={getMetadataName(a.metadata)} id={a.id} key={a.id.id} />
                        ),
                        index !== authors.length - 1 ? (
                          index === authors.length - 2 ? (
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

function AuthorLink({name, id}: {name: string; id: UnpackedHypermediaId}) {
  const linkProps = useRouteLink({key: 'profile', id})
  return (
    <a {...linkProps} className="no-underline underline-offset-4 hover:underline" style={{}}>
      {name}
    </a>
  )
}

function Breadcrumbs({breadcrumbs}: {breadcrumbs: BreadcrumbEntry[]}) {
  const [first, ...rest] = breadcrumbs

  return (
    <div className="text-muted-foreground flex flex-1 items-center gap-2">
      {first && 'id' in first ? <HomeBreadcrumb crumb={first} /> : null}
      {rest.flatMap((crumb, i) => {
        const key = 'id' in crumb ? crumb.id.id : `label-${i}`
        return [
          <SizableText color="muted" key={`${key}-separator`} size="xs">
            {'>'}
          </SizableText>,
          'id' in crumb ? (
            <BreadcrumbLink key={key} crumb={crumb} />
          ) : (
            <span key={key} className="max-w-[15ch] truncate text-xs whitespace-nowrap">
              {crumb.label}
            </span>
          ),
        ]
      })}
    </div>
  )
}

function HomeBreadcrumb({crumb}: {crumb: Extract<BreadcrumbEntry, {id: any}>}) {
  const linkProps = useRouteLink({key: 'document', id: crumb.id})
  return (
    <a {...linkProps} className="text-muted-foreground flex items-center gap-1 no-underline hover:underline">
      <Home className="size-3" />
    </a>
  )
}

function BreadcrumbLink({crumb}: {crumb: Extract<BreadcrumbEntry, {id: any}>}) {
  const linkProps = useRouteLink({key: 'document', id: crumb.id})

  if (crumb.isLoading) {
    return (
      <span className="text-muted-foreground flex items-center gap-1 text-xs whitespace-nowrap">
        {crumb.fallbackName || crumb.id.path?.at(-1) || crumb.id.uid.slice(0, 8)}
        <Spinner size="small" />
      </span>
    )
  }

  if (crumb.isTombstone) {
    return (
      <Tooltip content="This document has been deleted">
        <span className="max-w-[15ch] truncate text-xs whitespace-nowrap text-red-500">
          {crumb.fallbackName || crumb.id.path?.at(-1) || crumb.id.uid.slice(0, 8)}
        </span>
      </Tooltip>
    )
  }

  if (crumb.isNotFound) {
    return (
      <Tooltip content="Document not found on the network">
        <span className="max-w-[15ch] truncate text-xs whitespace-nowrap text-red-500">
          {crumb.fallbackName || crumb.id.path?.at(-1) || crumb.id.uid.slice(0, 8)}
        </span>
      </Tooltip>
    )
  }

  if (crumb.isError) {
    return (
      <Tooltip content="Failed to load this document">
        <span className="max-w-[15ch] truncate text-xs whitespace-nowrap text-red-500">
          {crumb.fallbackName || crumb.id.path?.at(-1) || crumb.id.uid.slice(0, 8)}
        </span>
      </Tooltip>
    )
  }

  if (!crumb.metadata?.name) {
    return (
      <span className="text-muted-foreground max-w-[15ch] truncate text-xs whitespace-nowrap">
        {crumb.fallbackName || crumb.id.path?.at(-1) || crumb.id.uid.slice(0, 8)}
      </span>
    )
  }

  return (
    <a
      {...linkProps}
      className="max-w-[15ch] truncate overflow-hidden text-xs whitespace-nowrap no-underline hover:underline"
    >
      {crumb.metadata.name}
    </a>
  )
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
