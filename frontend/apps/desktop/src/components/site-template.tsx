import {grpcClient} from '@/grpc-client'
import {forkSitefromTemplate} from '@shm/shared/utils/fork'
import {eventStream} from '@shm/shared/utils/stream'
import {useEffect, useState} from 'react'
import {Dialog, SizableText, View, XStack, YStack} from 'tamagui'

export const [dispatchSiteTemplateEvent, siteTemplateEvents] =
  eventStream<boolean>()

export function SiteTemplate() {
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
            // template: z6Mkv1SrE6LFGkYKxZs33qap5MSQGbk41XnLdMu7EkKy3gv2
            forkSitefromTemplate({
              client: grpcClient,
              targetId: 'z6Mkka59Cpa9fUJ8SeAYkQsE1ifhaid1rb7jPNUtWaBfDU6r',
              templateId: 'z6Mkv1SrE6LFGkYKxZs33qap5MSQGbk41XnLdMu7EkKy3gv2',
            })
          }}
        >
          <View width={200} height={140} bg="$color7" />
          <SizableText>Template 1</SizableText>
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
          onPress={() => {}}
        >
          <View width={200} height={140} bg="$color7" />
          <SizableText>Template 2</SizableText>
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
          onPress={() => {}}
        >
          <View width={200} height={140} bg="$color7" />
          <SizableText>Template 3</SizableText>
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
