import {grpcClient} from '@/grpc-client'
import {useNavigate} from '@/utils/useNavigate'
import {DocumentRoute, hmId, invalidateQueries, queryKeys} from '@shm/shared'
import {cloneSiteFromTemplate} from '@shm/shared/utils/clone'
import {Button} from '@shm/ui/button'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {Tooltip} from '@shm/ui/tooltip'
import {ExternalLink} from 'lucide-react'
import {MouseEvent, useEffect, useState} from 'react'

import {templates} from '../app-templates'
import {dispatchEditPopover} from './onboarding'

// Import template images

import blogDark from '@/images/template-blog-dark.png'
import blogLight from '@/images/template-blog-light.png'
import documentationDark from '@/images/template-documentation-dark.png'
import documentationLight from '@/images/template-documentation-light.png'
import {useSubscribedResource} from '@/models/entities'
import {useIsOnline} from '@/models/networking'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {cn} from '@shm/ui/utils'
import {nanoid} from 'nanoid'

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
  const blogTemplate = useSubscribedResource(hmId(templates.blog))
  const documentationTemplate = useSubscribedResource(
    hmId(templates.documentation),
  )
  const blogTemplateDocument =
    // @ts-ignore
    blogTemplate.data?.type === 'document'
      ? // @ts-ignore
        blogTemplate.data.document
      : undefined
  const documentationTemplateDocument =
    // @ts-ignore
    documentationTemplate.data?.type === 'document'
      ? // @ts-ignore
        documentationTemplate.data.document
      : undefined
  function confirmTemplate() {
    const targetId = route.id?.uid
    if (!targetId) return

    onClose()

    setTimeout(() => {
      const id = hmId(targetId)
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
      <SizableText size="xl" weight="bold">
        Choose a Template to get Started
      </SizableText>
      <div className="flex">
        <TemplateItem
          template={templates.blog}
          active={selectedTemplate === 'blog'}
          name="blog"
          label="Blog"
          isOnline={isOnline}
          onPress={
            blogTemplateDocument
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
              id: hmId(templates.blog),
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
            documentationTemplateDocument
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
              id: hmId(templates.documentation),
            })
          }}
        />
        <div
          className={cn(
            'relative flex cursor-pointer flex-col items-center gap-2 rounded-lg p-4 pb-2',
            selectedTemplate === 'blank'
              ? 'bg-primary hover:bg-primary'
              : 'bg-transparent hover:bg-black/5 dark:hover:bg-white/10',
          )}
          onClick={() => {
            setSelectedTemplate('blank')
          }}
        >
          <div className="bg-muted h-[140px] w-[200px] rounded" />

          <SizableText
            className={cn(
              selectedTemplate === 'blank'
                ? 'text-primary-foreground'
                : 'text-muted-foreground',
            )}
          >
            Blank
          </SizableText>
        </div>
      </div>
      {!isOnline ? (
        <div className="bg-destructive/10 flex w-full items-center rounded-lg p-4">
          <SizableText className="text-center">
            You need to be connected to the internet to use templates
          </SizableText>
        </div>
      ) : null}
      <Button
        className={cn(
          'bg-primary text-primary-foreground hover:bg-primary/90 focus:bg-primary/80 border-0',
          selectedTemplate == null && 'opacity-50',
        )}
        disabled={selectedTemplate == null}
        onClick={confirmTemplate}
      >
        Submit
      </Button>
    </div>
  )
}

export function useTemplateDialog(route: DocumentRoute) {
  const dialog = useAppDialog(SiteTemplate, {
    containerClassName: 'max-w-3xl',
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
  onPress?: () => void
  onPressExternal?: (e: MouseEvent<HTMLButtonElement>) => void
}) {
  const resource = useSubscribedResource(hmId(template))
  const document = {
    /* @ts-ignore */
  }
  resource.data?.type === 'document' ? resource.data.document : undefined
  return (
    <div
      className={cn(
        'relative flex cursor-pointer flex-col items-center gap-2 rounded-lg p-4 pb-2',
        !!document && isOnline ? 'opacity-100' : 'opacity-50',
        active
          ? 'bg-primary hover:bg-primary'
          : 'bg-transparent hover:bg-black/5 dark:hover:bg-white/10',
      )}
      onClick={onPress}
    >
      <TemplateImage name={name} />
      <div className="flex items-center gap-3">
        <SizableText
          className={cn(
            active ? 'text-primary-foreground' : 'text-muted-foreground',
          )}
        >
          {label}
        </SizableText>
        <Tooltip content="Preview Documentation Site">
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'hover:bg-transparent',
              active ? 'text-primary-foreground' : 'text-muted-foreground',
            )}
            onClick={onPressExternal}
          >
            <ExternalLink
              className={cn(
                'size-3',
                active
                  ? 'stroke-primary-foreground text-primary-foreground'
                  : 'stroke-foreground text-foreground',
              )}
            />
          </Button>
        </Tooltip>
      </div>
      {document ? null : (
        <>
          <Tooltip content="Loading template..." side="top">
            <div
              className="bg-background absolute top-0 left-0 h-full w-full opacity-50"
              onClick={(e) => {
                e.stopPropagation()
                e.preventDefault()
              }}
            />
          </Tooltip>
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 transform">
            <Spinner />
          </div>
        </>
      )}
    </div>
  )
}
