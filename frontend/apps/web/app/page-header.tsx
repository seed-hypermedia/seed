import {
  getMetadataName,
  HMDocument,
  HMMetadata,
  HMMetadataPayload,
  UnpackedHypermediaId,
} from '@shm/shared'
import {Container} from '@shm/ui/container'
import {DocumentDate} from '@shm/ui/document-date'
import {DonateButton} from '@shm/ui/donate-button'
import {HMIcon} from '@shm/ui/hm-icon'
import {Home} from '@shm/ui/icons'
import {Separator} from '@shm/ui/separator'
import {SizableText} from '@shm/ui/text'
import {useMemo} from 'react'
import {getHref} from './href'

export function PageHeader({
  docMetadata,
  docId,
  authors = [],
  updateTime = null,
  breadcrumbs = [],
  originHomeId,
}: {
  docMetadata: HMMetadata | null
  docId: UnpackedHypermediaId | null
  authors: HMMetadataPayload[]
  updateTime: HMDocument['updateTime'] | null
  breadcrumbs: HMMetadataPayload[]
  originHomeId: UnpackedHypermediaId | null
}) {
  const hasCover = useMemo(() => !!docMetadata?.cover, [docMetadata])
  const hasIcon = useMemo(() => !!docMetadata?.icon, [docMetadata])
  const isHomeDoc = !docId?.path?.length
  return (
    <div id="page-header">
      <Container className="dark:bg-background bg-white">
        <div className="flex flex-col gap-4">
          {!isHomeDoc && docId && hasIcon ? (
            <div className={`mt-[${hasCover ? -80 : 0}px]`}>
              <HMIcon size={100} id={docId} name={docMetadata?.name} icon={docMetadata?.icon} />
            </div>
          ) : null}
          {/* @ts-expect-error */}
          <Breadcrumbs breadcrumbs={breadcrumbs} originHomeId={originHomeId} />
          <SizableText size="4xl" weight="bold">
            {docMetadata?.name}
          </SizableText>
          {docMetadata?.summary ? (
            <span className="font-body text-muted-foreground text-xl">
              {docMetadata?.summary}
            </span>
          ) : null}
          <div className="flex flex-1 flex-wrap items-center gap-4">
            {authors?.length ? (
              <div className="flex max-w-full flex-wrap items-center gap-1">
                {authors.flatMap((a, index) => [
                  <a
                    key={a.id.id}
                    href={getHref(originHomeId, a.id)}
                    className="cursor-pointer text-sm font-bold"
                  >
                    {getMetadataName(a.metadata)}
                  </a>,
                  index !== authors.length - 1 ? (
                    index === authors.length - 2 ? (
                      <SizableText key={`${a}-and`} size="xs" weight="bold">
                        {' & '}
                      </SizableText>
                    ) : (
                      <SizableText size="xs" key={`${a}-comma`} weight="bold">
                        {', '}
                      </SizableText>
                    )
                  ) : null,
                ])}
              </div>
            ) : null}
            {authors?.length ? <div className="bg-border h-6 w-px" /> : null}
            {updateTime ? (
              <DocumentDate
                metadata={docMetadata || undefined}
                updateTime={updateTime}
              />
            ) : null}
            <div className="flex-1" />
            {docId && <DonateButton docId={docId} authors={authors} />}
          </div>
          <Separator />
        </div>
      </Container>
    </div>
  )
}

function Breadcrumbs({
  breadcrumbs,
  originHomeId,
}: {
  breadcrumbs: Array<{
    id: UnpackedHypermediaId
    metadata: HMMetadata
  }>
  originHomeId: UnpackedHypermediaId | null
}) {
  // const displayBreadcrumbs = breadcrumbs.filter((breadcrumb) => {
  //   if (
  //     !breadcrumb.id.path?.length &&
  //     homeId &&
  //     breadcrumb.id.uid === homeId.uid
  //   )
  //     return null;
  // });
  // const displayBreadcrumbs = breadcrumbs.filter((bc) => {
  //   console.log(`== ~ Breadcrumbs ~ bc:`, bc);
  //   return true;
  // });

  const [first, ...rest] = breadcrumbs

  return (
    <div className="flex flex-1 items-center gap-2">
      {first ? (
        <div className="flex items-center gap-1">
          <Home className="text-foreground size-3" />
          <SizableText
            color="muted"
            asChild
            size="xs"
            className="max-w-[15ch] truncate overflow-hidden whitespace-nowrap no-underline hover:underline"
          >
            <a
              key={first.id.id}
              href={originHomeId ? getHref(originHomeId, first.id) : undefined}
            >
              {first.metadata?.name}
            </a>
          </SizableText>
        </div>
      ) : null}
      {rest.flatMap((crumb, index) => {
        return [
          <SizableText color="muted" key={`${crumb.id.id}-slash`} size="xs">
            /
          </SizableText>,
          <SizableText
            color="muted"
            asChild
            size="xs"
            key={crumb.id.id}
            className="max-w-[15ch] truncate overflow-hidden whitespace-nowrap no-underline hover:underline"
          >
            <a
              href={originHomeId ? getHref(originHomeId, crumb.id) : undefined}
            >
              {crumb.metadata?.name}
            </a>
          </SizableText>,
        ]
      })}
    </div>
  )
}
