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
import {Separator} from '@shm/ui/separator'
import {SizableText} from '@shm/ui/text'
import {ButtonText} from '@tamagui/button'
import {Home} from '@tamagui/lucide-icons'
import {XStack} from '@tamagui/stacks'
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
  breadcrumbs: Array<{
    id: UnpackedHypermediaId
    metadata: HMMetadata
  }>
  originHomeId: UnpackedHypermediaId | null
}) {
  const hasCover = useMemo(() => !!docMetadata?.cover, [docMetadata])
  const hasIcon = useMemo(() => !!docMetadata?.icon, [docMetadata])
  const isHomeDoc = !docId?.path?.length
  return (
    <div id="page-header">
      <Container
        $gtSm={{
          marginTop: hasCover ? -40 : 0,
          paddingTop: !hasCover ? 60 : '$4',
        }}
        $gtLg={{maxWidth: 1200}}
        bg="$backgroundStrong"
        borderTopLeftRadius="$2"
        borderTopRightRadius="$2"
      >
        <div className="flex flex-col gap-4">
          {!isHomeDoc && docId && hasIcon ? (
            <div className={`mt-[${hasCover ? -80 : 0}px]`}>
              <HMIcon size={100} id={docId} metadata={docMetadata} />
            </div>
          ) : null}
          <Breadcrumbs breadcrumbs={breadcrumbs} originHomeId={originHomeId} />
          <SizableText size="4xl" weight="bold">
            {docMetadata?.name}
          </SizableText>
          <div className="flex gap-4 items-center flex-1 flex-wrap">
            {authors?.length ? (
              <div className="flex gap-1 items-center flex-wrap max-w-full">
                {authors.flatMap((a, index) => [
                  <ButtonText
                    hoverStyle={{
                      textDecorationLine: 'underline',
                      textDecorationColor: 'currentColor',
                    }}
                    size="$2"
                    cursor="pointer"
                    fontWeight="bold"
                    key={a.id.id}
                    tag="a"
                    href={getHref(originHomeId, a.id)}
                    style={{textDecoration: 'none'}}
                  >
                    {getMetadataName(a.metadata)}
                  </ButtonText>,
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
            {authors?.length ? (
              <Separator vertical className="self-stretch h-" />
            ) : null}
            {updateTime ? (
              <DocumentDate
                metadata={docMetadata || undefined}
                updateTime={updateTime}
              />
            ) : null}
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
    <XStack flex={1} gap="$2" alignItems="center">
      {first ? (
        <XStack alignItems="center" gap="$1">
          <Home color="$color10" size={12} />
          <SizableText
            color="muted"
            asChild
            size="xs"
            className="overflow-hidden truncate whitespace-nowrap max-w-[15ch] no-underline hover:underline"
          >
            <a
              key={first.id.id}
              href={originHomeId ? getHref(originHomeId, first.id) : undefined}
            >
              {first.metadata?.name}
            </a>
          </SizableText>
        </XStack>
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
            className="no-underline overflow-hidden hover:underline truncate whitespace-nowrap max-w-[15ch]"
          >
            <a
              href={originHomeId ? getHref(originHomeId, crumb.id) : undefined}
            >
              {crumb.metadata?.name}
            </a>
          </SizableText>,
        ]
      })}
    </XStack>
  )
}
