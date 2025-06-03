import {grpcClient} from '@/grpc-client'
import {useNavigate} from '@/utils/useNavigate'
import {DocumentRoute, hmId, invalidateQueries, queryKeys} from '@shm/shared'
import {cloneSiteFromTemplate} from '@shm/shared/utils/clone'
import {Button} from '@shm/ui/button'
import {ExternalLink} from '@shm/ui/icons'
import {Spinner} from '@shm/ui/spinner'
import {Tooltip} from '@shm/ui/tooltip'
import {MouseEvent, useEffect, useState} from 'react'

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
      const id = hmId('d', targetId)
      invalidateQueries([queryKeys.ENTITY, id.id])
      invalidateQueries([queryKeys.ACCOUNT, id.uid])
      invalidateQueries([queryKeys.RESOLVED_ENTITY, id.id])
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
        accessory: {key: 'options'},
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
    <div className="flex flex-col items-center gap-6">
      <h2 className="text-xl font-bold">Choose a Template to get Started</h2>
      <div className="flex">
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
        <div
          className={`flex flex-col p-4 pb-2 gap-2 rounded-lg items-center cursor-pointer transition-all duration-200 ease-in-out ${
            selectedTemplate === 'blank'
              ? 'bg-blue-500 dark:bg-blue-600'
              : 'bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800'
          }`}
          onClick={() => {
            setSelectedTemplate('blank')
          }}
        >
          <div className="w-[200px] h-[140px] bg-gray-300 dark:bg-gray-600" />
          <span
            className={
              selectedTemplate === 'blank'
                ? 'text-white'
                : 'text-gray-600 dark:text-gray-400'
            }
          >
            Blank
          </span>
        </div>
      </div>
      {!isOnline ? (
        <div className="bg-red-100 dark:bg-red-900 p-4 rounded-lg w-full flex items-center justify-center">
          <p className="text-red-800 dark:text-red-200 text-center">
            You need to be connected to the internet to use templates
          </p>
        </div>
      ) : null}
      <Button
        className={`${selectedTemplate == null ? 'opacity-50' : 'opacity-100'}`}
        disabled={selectedTemplate == null}
        onClick={confirmTemplate}
        variant="default"
      >
        Submit
      </Button>
    </div>
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
  onPress?: (e: MouseEvent<HTMLDivElement>) => void
  onPressExternal: (e: MouseEvent<HTMLButtonElement>) => void
}) {
  const e = useSubscribedEntity(hmId('d', template))
  return (
    <div
      className={`relative flex flex-col p-4 pb-2 gap-2 rounded-lg items-center cursor-pointer transition-all duration-200 ease-in-out ${
        !!e.data?.document && isOnline ? 'opacity-100' : 'opacity-50'
      } ${
        active
          ? 'bg-blue-500 dark:bg-blue-600'
          : 'bg-transparent hover:bg-gray-100 dark:hover:bg-gray-800'
      }`}
      onClick={onPress}
    >
      <TemplateImage name={name} />
      <div className="flex items-center gap-3">
        <span
          className={active ? 'text-white' : 'text-gray-600 dark:text-gray-400'}
        >
          {label}
        </span>
        <Tooltip content="Preview Documentation Site">
          <Button variant="ghost" size="sm" onClick={onPressExternal}>
            <ExternalLink color={active ? 'white' : '$color10'} />
          </Button>
        </Tooltip>
      </div>
      {e.data?.document ? null : (
        <>
          <Tooltip content="Loading template..." side="top">
            <div
              className="absolute top-0 left-0 bg-white dark:bg-black opacity-50 w-full h-full"
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
              }}
            />
          </Tooltip>
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2">
            <Spinner
              onClick={(e: MouseEvent<HTMLDivElement>) => {
                e.stopPropagation()
                e.preventDefault()
              }}
            />
          </div>
        </>
      )}
    </div>
  )
}
