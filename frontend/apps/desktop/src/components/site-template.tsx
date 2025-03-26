import {grpcClient} from '@/grpc-client'
import {useNavRoute} from '@/utils/navigation'
import {useNavigate} from '@/utils/useNavigate'
import {DocumentRoute, hmId, queryClient, queryKeys} from '@shm/shared'
import {forkSitefromTemplate} from '@shm/shared/utils/fork'
import {eventStream} from '@shm/shared/utils/stream'
import {Tooltip} from '@shm/ui/tooltip'
import {ExternalLink} from '@tamagui/lucide-icons'
import {useEffect, useMemo, useState} from 'react'
import {Button, Dialog, SizableText, View, XStack, YStack} from 'tamagui'
import {dispatchEditPopover} from './onboarding'

let templates = {
  blog: 'z6Mkv1SrE6LFGkYKxZs33qap5MSQGbk41XnLdMu7EkKy3gv2',
  documentation: 'z6Mkk4LFMaccittZNsRiE1VPuzaZYWu5QnpUtQHsMLnrr7tN',
}

export const [dispatchSiteTemplateEvent, siteTemplateEvents] =
  eventStream<boolean>()

export function SiteTemplate() {
  const [selectedTemplate, setSelectedTemplate] = useState<
    'blog' | 'documentation' | 'blank' | null
  >(null)
  const route = useNavRoute()
  const navigate = useNavigate('push')
  const openWindow = useNavigate('spawn')
  const targetId = useMemo(() => {
    if (route.key === 'document') {
      return route.id.uid
    }
    return ''
  }, [route])

  function handleForking() {
    if (!targetId) return
    if (selectedTemplate === 'blank') {
      dispatchSiteTemplateEvent(false)
      navigate({
        key: 'draft',
        id: (route as DocumentRoute).id,
      })
      return
    }

    if (targetId && selectedTemplate) {
      forkSitefromTemplate({
        client: grpcClient,
        targetId,
        templateId: templates[selectedTemplate],
      }).then((targetVersion) => {
        dispatchSiteTemplateEvent(false)
        queryClient.invalidateQueries({
          queryKey: [queryKeys.ENTITY, (route as DocumentRoute).id?.id],
        })

        setTimeout(() => {
          dispatchEditPopover(true)
        }, 500)
      })
      return
    }
  }

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
          bg={selectedTemplate === 'blog' ? '$brand5' : 'transparent'}
          hoverStyle={{
            bg: selectedTemplate === 'blog' ? '$brand5' : '$color5',
          }}
          alignItems="center"
          onPress={() => {
            setSelectedTemplate('blog')
          }}
        >
          <TemplateImage name="blog" />
          <XStack ai="center" gap="$3">
            <SizableText
              color={selectedTemplate === 'blog' ? '$color1' : '$color10'}
            >
              Blog
            </SizableText>
            <Tooltip content="Preview Blog Site">
              <Button
                chromeless
                color={selectedTemplate === 'blog' ? '$color1' : '$color10'}
                icon={ExternalLink}
                onPress={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  openWindow({
                    key: 'document',
                    id: hmId('d', templates.blog),
                  })
                }}
                size="$2"
              />
            </Tooltip>
          </XStack>
        </YStack>
        <YStack
          p="$4"
          paddingBottom="$2"
          gap="$2"
          borderRadius="$4"
          hoverStyle={{
            bg: selectedTemplate === 'documentation' ? '$brand5' : '$color5',
          }}
          bg={selectedTemplate === 'documentation' ? '$brand5' : 'transparent'}
          alignItems="center"
          onPress={() => {
            setSelectedTemplate('documentation')
          }}
        >
          <TemplateImage name="documentation" />
          <XStack ai="center" gap="$3">
            <SizableText
              color={
                selectedTemplate === 'documentation' ? '$color1' : '$color10'
              }
            >
              Documentation
            </SizableText>
            <Tooltip content="Preview Documentation Site">
              <Button
                chromeless
                color={
                  selectedTemplate === 'documentation' ? '$color1' : '$color10'
                }
                icon={ExternalLink}
                onPress={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  openWindow({
                    key: 'document',
                    id: hmId('d', templates.documentation),
                  })
                }}
                size="$2"
              />
            </Tooltip>
          </XStack>
        </YStack>
        <YStack
          p="$4"
          paddingBottom="$2"
          gap="$2"
          borderRadius="$4"
          bg={selectedTemplate === 'blank' ? '$brand5' : 'transparent'}
          hoverStyle={{
            bg: selectedTemplate === 'blank' ? '$brand5' : '$color5',
          }}
          alignItems="center"
          onPress={() => {
            setSelectedTemplate('blank')
          }}
        >
          <View width={200} height={140} bg="$color7" />
          <SizableText
            color={selectedTemplate === 'blank' ? '$color1' : '$color10'}
          >
            Blank
          </SizableText>
        </YStack>
      </XStack>
      <Button
        opacity={selectedTemplate == null ? 0.5 : 1}
        disabled={selectedTemplate == null}
        onPress={handleForking}
        bg="$brand5"
        color="white"
        justifyContent="center"
        textAlign="center"
        userSelect="none"
        borderColor="$colorTransparent"
        borderWidth={0}
        hoverStyle={{
          bg: '$brand4',
          borderWidth: 0,
        }}
        focusStyle={{
          bg: '$brand3',
          borderWidth: 0,
        }}
      >
        Submit
      </Button>
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
