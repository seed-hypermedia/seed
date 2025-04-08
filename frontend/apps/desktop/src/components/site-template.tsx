import {grpcClient} from '@/grpc-client'
import {useNavigate} from '@/utils/useNavigate'
import {DocumentRoute, hmId, invalidateQueries, queryKeys} from '@shm/shared'
import {cloneSiteFromTemplate} from '@shm/shared/utils/clone'
import {Tooltip} from '@shm/ui/tooltip'
import {ExternalLink} from '@tamagui/lucide-icons'
import {useEffect, useState} from 'react'
import {
  Button,
  ButtonProps,
  SizableText,
  Spinner,
  View,
  XStack,
  YStack,
} from 'tamagui'
import {templates} from '../app-templates'
import {dispatchEditPopover} from './onboarding'

// Import template images

import blogDark from '@/images/template-blog-dark.png'
import blogLight from '@/images/template-blog-light.png'
import documentationDark from '@/images/template-documentation-dark.png'
import documentationLight from '@/images/template-documentation-light.png'
import {useSubscribedEntity} from '@/models/entities'
import {useIsOnline} from '@/models/networking'
import {nanoid} from 'nanoid'
import {useAppDialog} from './dialog'

export function SiteTemplate({
  onClose,
  input,
}: {
  onClose: () => void
  input: DocumentRoute
}) {
  const isOnline = useIsOnline()
  const [selectedTemplate, setSelectedTemplate] = useState<
    'blog' | 'documentation' | 'blank' | null
  >(null)
  const route = input
  const navigate = useNavigate('push')
  const openWindow = useNavigate('spawn')
  const blogTemplate = useSubscribedEntity(hmId('d', templates.blog))
  const documentationTemplate = useSubscribedEntity(
    hmId('d', templates.documentation),
  )
  function confirmTemplate() {
    const targetId = route.id?.uid
    if (!targetId) return

    onClose()

    setTimeout(() => {
      invalidateQueries([queryKeys.ENTITY, (route as DocumentRoute).id?.id])
      invalidateQueries([queryKeys.LOCAL_ACCOUNT_ID_LIST])
    }, 500)
    if (selectedTemplate === 'blank') {
      navigate({
        key: 'draft',
        id: nanoid(10),
        editUid: (route as DocumentRoute).id.uid,
        editPath: (route as DocumentRoute).id.path || [],
        // @ts-expect-error version is always a string
        deps:
          typeof (route as DocumentRoute).id.version === 'string'
            ? [(route as DocumentRoute).id.version]
            : [],
      })
      return
    }

    if (targetId && selectedTemplate) {
      cloneSiteFromTemplate({
        client: grpcClient,
        targetId,
        templateId: templates[selectedTemplate],
      }).then((targetVersion) => {
        setTimeout(() => {
          dispatchEditPopover(true)
        }, 1500)
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
        <TemplateItem
          template={templates.blog}
          active={selectedTemplate === 'blog'}
          name="blog"
          label="Blog"
          isOnline={isOnline}
          onPress={
            blogTemplate.data?.document
              ? () => {
                  if (!isOnline) return
                  setSelectedTemplate('blog')
                }
              : undefined
          }
          onPressExternal={(e) => {
            e.stopPropagation()
            e.preventDefault()
            openWindow({
              key: 'document',
              id: hmId('d', templates.blog),
            })
          }}
        />
        <TemplateItem
          template={templates.documentation}
          active={selectedTemplate === 'documentation'}
          name="documentation"
          label="Documentation"
          isOnline={isOnline}
          onPress={
            documentationTemplate.data?.document
              ? () => {
                  if (!isOnline) return
                  setSelectedTemplate('documentation')
                }
              : undefined
          }
          onPressExternal={(e) => {
            e.stopPropagation()
            e.preventDefault()
            openWindow({
              key: 'document',
              id: hmId('d', templates.documentation),
            })
          }}
        />
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
      {!isOnline ? (
        <YStack
          bg="$red5"
          p="$4"
          borderRadius="$4"
          width="100%"
          alignItems="center"
        >
          <SizableText color="$color" textAlign="center">
            You need to be connected to the internet to use templates
          </SizableText>
        </YStack>
      ) : null}
      <Button
        opacity={selectedTemplate == null ? 0.5 : 1}
        disabled={selectedTemplate == null}
        onPress={confirmTemplate}
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

export function useTemplateDialog(route: DocumentRoute) {
  const dialog = useAppDialog(SiteTemplate, {
    contentProps: {
      maxWidth: null,
      width: null,
    },
  })
  const navigate = useNavigate('replace')
  useEffect(() => {
    if (route.immediatelyPromptTemplate) {
      dialog.open(route)
      navigate({
        ...route,
        immediatelyPromptTemplate: false,
      })
    }
  }, [route.immediatelyPromptTemplate])
  return dialog.content
}

function TemplateImage({name}: {name: 'blog' | 'documentation'}) {
  const lightImage = name === 'blog' ? blogLight : documentationLight
  const darkImage = name === 'blog' ? blogDark : documentationDark

  return (
    <picture style={{width: 200, height: 140}}>
      <source media="(prefers-color-scheme: dark)" srcSet={darkImage} />
      <source media="(prefers-color-scheme: light)" srcSet={lightImage} />
      <img style={{width: 200, height: 140}} src={lightImage} alt={name} />
    </picture>
  )
}

function TemplateItem({
  name,
  active,
  template,
  label,
  isOnline,
  onPress,
  onPressExternal,
}: {
  active: boolean
  name: 'blog' | 'documentation'
  template: string
  label: string
  isOnline: boolean
  onPress: ButtonProps['onPress']
  onPressExternal: ButtonProps['onPress']
}) {
  const e = useSubscribedEntity(hmId('d', template))
  return (
    <YStack
      opacity={!!e.data?.document && isOnline ? 1 : 0.5}
      p="$4"
      paddingBottom="$2"
      position="relative"
      gap="$2"
      borderRadius="$4"
      hoverStyle={{
        bg: active ? '$brand5' : '$color5',
      }}
      bg={active ? '$brand5' : 'transparent'}
      alignItems="center"
      onPress={onPress}
    >
      <TemplateImage name={name} />
      <XStack ai="center" gap="$3">
        <SizableText color={active ? '$color1' : '$color10'}>
          {label}
        </SizableText>
        <Tooltip content="Preview Documentation Site">
          <Button
            chromeless
            color={active ? '$color1' : '$color10'}
            icon={ExternalLink}
            onPress={onPressExternal}
            size="$2"
          />
        </Tooltip>
      </XStack>
      {e.data?.document ? null : (
        <>
          <Tooltip content="Loading template..." placement="top">
            <View
              position="absolute"
              top={0}
              left={0}
              bg="$background"
              opacity={0.5}
              width="100%"
              height="100%"
              onPress={(e) => {
                e.stopPropagation()
                e.preventDefault()
              }}
            />
          </Tooltip>
          <Spinner
            position="absolute"
            top="50%"
            left="50%"
            onPress={(e) => {
              e.stopPropagation()
              e.preventDefault()
            }}
            x={-10}
            y={-10}
          />
        </>
      )}
    </YStack>
  )
}
