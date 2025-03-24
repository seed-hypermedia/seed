import {grpcClient} from '@/grpc-client'
import {useNavRoute} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {DocumentRoute} from '@shm/shared'
import {forkSitefromTemplate} from '@shm/shared/utils/fork'
import {eventStream} from '@shm/shared/utils/stream'
import {useEffect, useMemo, useState} from 'react'
import {Dialog, SizableText, View, XStack, YStack} from 'tamagui'

export const [dispatchSiteTemplateEvent, siteTemplateEvents] =
  eventStream<boolean>()

export function SiteTemplate() {
  const route = useNavRoute()
  const navigate = useNavigate('push')
  const targetId = useMemo(() => {
    if (route.key === 'document') {
      return route.id.uid
    }
    return ''
  }, [route])

  return (
    <YStack alignItems="center" gap="$6">
      <SizableText size="$6" fontWeight="bold">
        Choose a Template to get Started
      </SizableText>
      <XStack>
        <YStack
          p="$4"
          paddingBottom="$2"
          gap="$2"
          borderRadius="$4"
          hoverStyle={{
            bg: '$color5',
          }}
          alignItems="center"
          onPress={() => {
            if (targetId) {
              // template: z6Mkv1SrE6LFGkYKxZs33qap5MSQGbk41XnLdMu7EkKy3gv2
              forkSitefromTemplate({
                client: grpcClient,
                targetId,
                templateId: 'z6Mkv1SrE6LFGkYKxZs33qap5MSQGbk41XnLdMu7EkKy3gv2',
              }).then(() => {
                dispatchSiteTemplateEvent(false)
                window.location.reload()
              })
            }
          }}
        >
          <TemplateImage name="blog" />
          <SizableText>Blog</SizableText>
        </YStack>
        <YStack
          p="$4"
          paddingBottom="$2"
          gap="$2"
          borderRadius="$4"
          hoverStyle={{
            bg: '$color5',
          }}
          alignItems="center"
          onPress={() => {
            if (targetId) {
              // template: z6Mkv1SrE6LFGkYKxZs33qap5MSQGbk41XnLdMu7EkKy3gv2
              forkSitefromTemplate({
                client: grpcClient,
                targetId,
                templateId: 'z6Mkk4LFMaccittZNsRiE1VPuzaZYWu5QnpUtQHsMLnrr7tN',
              }).then(() => {
                dispatchSiteTemplateEvent(false)
                window.location.reload()
              })
            }
          }}
        >
          <TemplateImage name="documentation" />
          <SizableText>Documentation</SizableText>
        </YStack>
        <YStack
          p="$4"
          paddingBottom="$2"
          gap="$2"
          borderRadius="$4"
          hoverStyle={{
            bg: '$color5',
          }}
          alignItems="center"
          onPress={() => {
            if (targetId) {
              dispatchSiteTemplateEvent(false)
              navigate({
                key: 'draft',
                id: (route as DocumentRoute).id,
              })
            }
          }}
        >
          <View width={200} height={140} bg="$color7" />
          <SizableText>Blanc</SizableText>
        </YStack>
      </XStack>
    </YStack>
  )
}

export function SiteTemplateDialog() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    siteTemplateEvents.subscribe((val) => {
      if (!val) {
        // reset template process
      }
      setOpen(val)
    })
  }, [])

  return (
    <Dialog
      open={open}
      onOpenChange={(val: boolean) => {
        dispatchSiteTemplateEvent(val)
        if (!val) {
          // reset template process
        }
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          height="100vh"
          bg={'#00000088'}
          width="100vw"
          animation="fast"
          opacity={0.8}
          enterStyle={{opacity: 0}}
          exitStyle={{opacity: 0}}
        />
        <Dialog.Content
          overflow="hidden"
          backgroundColor={'$background'}
          animation={[
            'fast',
            {
              opacity: {
                overshootClamping: true,
              },
            },
          ]}
          enterStyle={{y: -10, opacity: 0}}
          exitStyle={{y: -10, opacity: 0}}
        >
          <SiteTemplate />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}

function TemplateImage({name}: {name: 'blog' | 'documentation'}) {
  return (
    <picture style={{width: 200, height: 140}}>
      <source
        media="(prefers-color-scheme: dark)"
        srcSet={`/assets/template-${name}-dark.png`}
      />
      <source
        media="(prefers-color-scheme: light)"
        srcSet={`/assets/template-${name}-light.png`}
      />
      <img
        style={{width: 200, height: 140}}
        src={`/assets/template-${name}-light.png`}
        alt={name}
      />
    </picture>
  )
}
