import {
  getMetadataName,
  HMDocument,
  HMMetadata,
  HMMetadataPayload,
  UnpackedHypermediaId,
} from '@shm/shared'
import {MessageSquare, Sparkle} from 'lucide-react'
import {useMemo} from 'react'
import {Container} from './container'
import {DocumentDate} from './document-date'
import {DonateButton} from './donate-button'
import {HMIcon} from './hm-icon'
import {Home} from './icons'
import {InteractionSummaryItem} from './interaction-summary'
import {Separator} from './separator'
import {SizableText} from './text'

export function DocumentHeader({
  docId,
  docMetadata,
  authors = [],
  updateTime = null,
  breadcrumbs,
  siteUrl,
  onAuthorClick,
  commentsCount = 0,
  onCommentsClick,
  onFeedClick,
}: {
  docId: UnpackedHypermediaId | null
  docMetadata: HMMetadata | null
  authors: HMMetadataPayload[]
  updateTime: HMDocument['updateTime'] | null
  breadcrumbs?: Array<{
    id: UnpackedHypermediaId
    metadata: HMMetadata
  }>
  siteUrl?: string
  onAuthorClick?: (authorId: UnpackedHypermediaId) => void
  commentsCount?: number
  onCommentsClick?: () => void
  onFeedClick?: () => void
}) {
  const hasCover = useMemo(() => !!docMetadata?.cover, [docMetadata])
  const hasIcon = useMemo(() => !!docMetadata?.icon, [docMetadata])
  const isHomeDoc = !docId?.path?.length

  return (
    <Container
      className="dark:bg-background w-full rounded-lg bg-white"
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
            <HMIcon
              size={100}
              id={docId}
              name={docMetadata?.name}
              icon={docMetadata?.icon}
            />
          </div>
        ) : null}
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <Breadcrumbs
            breadcrumbs={breadcrumbs}
            onAuthorClick={onAuthorClick}
          />
        ) : null}
        <SizableText size="4xl" weight="bold">
          {docMetadata?.name}
        </SizableText>
        {docMetadata?.summary ? (
          <span className="font-body text-muted-foreground text-xl">
            {docMetadata?.summary}
          </span>
        ) : null}
        <div className="flex flex-col gap-2">
          {siteUrl ? <SiteURLButton siteUrl={siteUrl} /> : null}
          <div className="flex flex-1 items-center justify-between gap-3">
            <div className="flex flex-1 flex-wrap items-center gap-3">
              {authors?.length ? (
                <>
                  <div className="flex max-w-full flex-wrap items-center gap-1">
                    {authors.flatMap((a, index) => {
                      return [
                        onAuthorClick ? (
                          <SizableText
                            key={a.id.id}
                            size="sm"
                            weight="bold"
                            className="underline-transparent hover:underline"
                            onClick={() => onAuthorClick(a.id)}
                          >
                            {getMetadataName(a.metadata)}
                          </SizableText>
                        ) : (
                          <SizableText
                            key={a.id.id}
                            size="sm"
                            weight="bold"
                            className="cursor-pointer"
                          >
                            {getMetadataName(a.metadata)}
                          </SizableText>
                        ),
                        index !== authors.length - 1 ? (
                          index === authors.length - 2 ? (
                            <SizableText
                              key={`${a.id.id}-and`}
                              size="xs"
                              weight="bold"
                            >
                              {' & '}
                            </SizableText>
                          ) : (
                            <SizableText
                              size="xs"
                              key={`${a.id.id}-comma`}
                              weight="bold"
                            >
                              {', '}
                            </SizableText>
                          )
                        ) : null,
                      ]
                    })}
                  </div>
                  <div className="bg-border h-6 w-px" />
                </>
              ) : null}
              {updateTime ? (
                <DocumentDate
                  metadata={docMetadata || undefined}
                  updateTime={updateTime}
                />
              ) : null}
            </div>
            {(onCommentsClick ||
              onFeedClick ||
              (docId && authors.length > 0)) && (
              <div className="flex items-center">
                {onFeedClick && (
                  <InteractionSummaryItem
                    label="Activity"
                    icon={<Sparkle className="text-muted-foreground size-3" />}
                    onClick={onFeedClick}
                    count={0}
                  />
                )}
                {onCommentsClick && (
                  <InteractionSummaryItem
                    label="Comments"
                    icon={
                      <MessageSquare className="text-muted-foreground size-3" />
                    }
                    onClick={onCommentsClick}
                    count={commentsCount}
                  />
                )}
                {docId && authors.length > 0 && (
                  <DonateButton docId={docId} authors={authors} />
                )}
              </div>
            )}
          </div>
        </div>
        <Separator />
      </div>
    </Container>
  )
}

function Breadcrumbs({
  breadcrumbs,
  onAuthorClick,
}: {
  breadcrumbs: Array<{
    id: UnpackedHypermediaId
    metadata: HMMetadata
  }>
  onAuthorClick?: (authorId: UnpackedHypermediaId) => void
}) {
  const [first, ...rest] = breadcrumbs

  return (
    <div className="flex flex-1 items-center gap-2">
      {first ? (
        <div className="flex items-center gap-1">
          <Home className="text-foreground size-3" />
          <SizableText
            color="muted"
            asChild={!!onAuthorClick}
            size="xs"
            className="max-w-[15ch] truncate overflow-hidden whitespace-nowrap no-underline hover:underline"
            onClick={onAuthorClick ? () => onAuthorClick(first.id) : undefined}
          >
            {onAuthorClick ? (
              <button type="button">{first.metadata?.name}</button>
            ) : (
              <span>{first.metadata?.name}</span>
            )}
          </SizableText>
        </div>
      ) : null}
      {rest.flatMap((crumb) => {
        return [
          <SizableText color="muted" key={`${crumb.id.id}-slash`} size="xs">
            /
          </SizableText>,
          <SizableText
            color="muted"
            asChild={!!onAuthorClick}
            size="xs"
            key={crumb.id.id}
            className="max-w-[15ch] truncate overflow-hidden whitespace-nowrap no-underline hover:underline"
            onClick={onAuthorClick ? () => onAuthorClick(crumb.id) : undefined}
          >
            {onAuthorClick ? (
              <button type="button">{crumb.metadata?.name}</button>
            ) : (
              <span>{crumb.metadata?.name}</span>
            )}
          </SizableText>,
        ]
      })}
    </div>
  )
}

function SiteURLButton({
  siteUrl,
  onSiteUrlClick,
}: {
  siteUrl: string
  onSiteUrlClick?: (url: string) => void
}) {
  return (
    <SizableText
      size="sm"
      className="underline-transparent hover:underline"
      onClick={() => onSiteUrlClick?.(siteUrl)}
    >
      {siteUrl}
    </SizableText>
  )
}
