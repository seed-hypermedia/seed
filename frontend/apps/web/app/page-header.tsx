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
import {useIsDark} from '@shm/ui/use-is-dark'
import {ButtonText} from '@tamagui/button'
import {Home} from '@tamagui/lucide-icons'
import {Separator} from '@tamagui/separator'
import {XStack, YStack} from '@tamagui/stacks'
import {H1, SizableText} from '@tamagui/text'
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
  const isDark = useIsDark()
  return (
    <YStack id="page-header">
      <Container
        $gtSm={{
          marginTop: hasCover ? -40 : 0,
          paddingTop: !hasCover ? 60 : '$4',
        }}
        $gtLg={{maxWidth: 1200}}
        bg={isDark ? '$background' : '$backgroundStrong'}
        borderTopLeftRadius="$2"
        borderTopRightRadius="$2"
      >
        <YStack gap="$4">
          {!isHomeDoc && docId && hasIcon ? (
            <XStack marginTop={hasCover ? -80 : 0}>
              <HMIcon size={100} id={docId} metadata={docMetadata} />
            </XStack>
          ) : null}
          <Breadcrumbs breadcrumbs={breadcrumbs} originHomeId={originHomeId} />
          <H1 size="$9" style={{fontWeight: 'bold'}}>
            {docMetadata?.name}
          </H1>
          <XStack
            marginBlock="$4"
            gap="$3"
            alignItems="center"
            flex={1}
            flexWrap="wrap"
          >
            {authors?.length ? (
              <XStack
                alignItems="center"
                gap={0}
                flexWrap="wrap"
                maxWidth="100%"
              >
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
                      <SizableText key={`${a}-and`} size="$2" fontWeight="bold">
                        {' & '}
                      </SizableText>
                    ) : (
                      <SizableText
                        size="$2"
                        key={`${a}-comma`}
                        fontWeight="bold"
                      >
                        {', '}
                      </SizableText>
                    )
                  ) : null,
                ])}
              </XStack>
            ) : null}
            {authors?.length ? <VerticalSeparator /> : null}
            {updateTime ? (
              <DocumentDate
                metadata={docMetadata || undefined}
                updateTime={updateTime}
              />
            ) : null}
            {docId && <DonateButton docId={docId} authors={authors} />}
          </XStack>
          <Separator />
        </YStack>
      </Container>
    </YStack>
  )
}

const VerticalSeparator = () => (
  <XStack flexShrink={0} flexGrow={0} width={1} height={20} bg="$color8" />
)

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
            color="$color10"
            tag="a"
            key={first.id.id}
            href={originHomeId ? getHref(originHomeId, first.id) : undefined}
            size="$1"
            overflow="hidden"
            textOverflow="ellipsis"
            whiteSpace="nowrap"
            textDecorationLine="none"
            hoverStyle={{
              textDecorationLine: 'underline',
              textDecorationColor: 'currentColor',
            }}
            maxWidth="15ch"
          >
            {first.metadata?.name}
          </SizableText>
        </XStack>
      ) : null}
      {rest.flatMap((crumb, index) => {
        return [
          <SizableText color="$color10" key={`${crumb.id.id}-slash`} size="$1">
            /
          </SizableText>,
          <SizableText
            color="$color10"
            tag="a"
            key={crumb.id.id}
            href={originHomeId ? getHref(originHomeId, crumb.id) : undefined}
            size="$1"
            textDecorationLine="none"
            overflow="hidden"
            hoverStyle={{
              textDecorationLine: 'underline',
              textDecorationColor: 'currentColor',
            }}
            textOverflow="ellipsis"
            whiteSpace="nowrap"
            textDecoration="none"
            maxWidth="15ch"
            // minWidth="8ch"
          >
            {crumb.metadata?.name}
          </SizableText>,
        ]
      })}
      {/* {docId?.id != homeId?.id ? (
        <SizableText
          size="$1"
          // fontWeight="bold"
          overflow="hidden"
          textOverflow="ellipsis"
          whiteSpace="nowrap"
          // flex={1}
        >
          {docMetadata?.name}
        </SizableText>
      ) : null} */}
    </XStack>
  )
}
