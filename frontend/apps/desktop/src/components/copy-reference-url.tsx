import {usePublishToSite} from '@/models/documents'
import {UnpackedHypermediaId} from '@shm/shared'
import {
  createWebHMUrl,
  HYPERMEDIA_ENTITY_TYPES,
  packHmId,
} from '@shm/shared/utils/entity-id-url'
import {StateStream, writeableStateStream} from '@shm/shared/utils/stream'
import {CheckboxField} from '@shm/ui/components/checkbox'
import {copyTextToClipboard} from '@shm/ui/copy-to-clipboard'
import {Spinner} from '@shm/ui/spinner'
import {toast} from '@shm/ui/toast'
import {useStream} from '@shm/ui/use-stream'
import {ReactNode, useState} from 'react'
import {Button, DialogDescription, XStack} from 'tamagui'
import {
  usePushOnCopy,
  useSetPushOnCopy,
  useSetPushOnPublish,
} from '../models/gateway-settings'
import {NavigationContext} from '../utils/navigation'
import {DialogTitle, useAppDialog} from './dialog'
type IsPublishedState = null | boolean // null: determined checked yet

export function useCopyReferenceUrl(
  hostname: string,
  originHomeId?: UnpackedHypermediaId | undefined,
  overrideNav?: NavigationContext,
) {
  const dialog = useAppDialog(PushToGatewayDialog, {
    overrideNavigation: overrideNav,
  })
  const pushOnCopy = usePushOnCopy()
  const publishToSite = usePublishToSite()
  function onCopy(input: UnpackedHypermediaId) {
    const url = createWebHMUrl(input.type, input.uid, {
      version: input.version,
      blockRef: input.blockRef,
      blockRange: input.blockRange,
      hostname,
      path: input.path,
      latest: input.latest,
      originHomeId,
      targetDocUid: input.targetDocUid,
      targetDocPath: input.targetDocPath,
    })
    copyTextToClipboard(url)
    if (pushOnCopy.data === 'never') {
      return
    }
    if (input.type !== 'd') {
      toast('Comment link copied to clipboard')
      return
    }
    const [setIsPublished, isPublished] =
      writeableStateStream<IsPublishedState>(null)

    const publishPromise = publishToSite(input, hostname)
      .then((didPublish) => {
        if (didPublish) {
          setIsPublished(true)
        } else {
          setIsPublished(false)
        }
      })
      .catch((e) => {
        toast.error('Failed to Publish: ' + e.message)
        setIsPublished(false)
      })
    toast.promise(publishPromise, {
      loading: `Pushing to ${hostname}`,
      success: (
        <CopiedToast
          isPublished={isPublished}
          host={hostname}
          hmId={packHmId(input)}
        />
      ),
      error: (
        <CopiedToast
          isPublished={isPublished}
          host={hostname}
          hmId={packHmId(input)}
        />
      ),
    })
  }
  return [dialog.content, onCopy] as const
}

function CopiedToast({
  isPublished,
  host,
  hmId,
}: {
  isPublished: StateStream<IsPublishedState>
  host: string
  hmId: string
}) {
  const published = useStream(isPublished)
  let indicator: ReactNode = null
  let message: ReactNode = ''
  if (published === null) {
    indicator = (
      <div className="flex items-center justify-center">
        <Spinner />
      </div>
    )
    message = (
      <>
        Copied URL, pushing to <b>{host}</b>
      </>
    )
  } else if (published === true) {
    message = (
      <>
        Copied URL, available on <b>{host}</b>
      </>
    )
  } else if (published === false) {
    message = (
      <>
        Copied URL, failed to push to <b>{host}</b>
      </>
    )
  }
  return message
}

export function PushToGatewayDialog({
  input,
  onClose,
}: {
  input: {
    host: string
    context: 'copy' | 'publish'
  } & UnpackedHypermediaId
  onClose: () => void
}) {
  const [shouldDoAlways, setShouldDoAlways] = useState(false)
  const setPushOnCopy = useSetPushOnCopy()
  const setPushOnPublish = useSetPushOnPublish()
  const entityType = input?.type
    ? HYPERMEDIA_ENTITY_TYPES[input.type]
    : 'Entity'
  function setDoEveryTime(everyTime: 'always' | 'never') {
    if (input.context === 'copy') {
      setPushOnCopy.mutate(everyTime)
    } else if (input.context === 'publish') {
      setPushOnPublish.mutate(everyTime)
    }
  }
  let title = `Push to ${input.host}`
  let description = `Push this ${entityType.toLowerCase()} to the public web gateway?`
  if (input.context === 'copy') {
    title = `${entityType} URL Copied. Push to ${input.host}?`
    description = `Could not verify this ${entityType.toLowerCase()} is publicly available. Would you like to push it now?`
  } else if (input.context === 'publish') {
    title = `${entityType} Published. Push to ${input.host}?`
  }
  return (
    <>
      <DialogTitle>{title}</DialogTitle>
      <DialogDescription>{description}</DialogDescription>
      <CheckboxField
        checked={shouldDoAlways}
        id="do-every-time"
        onCheckedChange={(checked: boolean) => setShouldDoAlways(checked)}
      >
        Do this every time
      </CheckboxField>
      <XStack gap="$1">
        {/* <Button
          theme="green"
          size="$2"
          iconAfter={push.isLoading ? <Spinner /> : null}
          onPress={() => {
            if (shouldDoAlways) setDoEveryTime('always')
            push
              .mutateAsync(packHmId(input))
              .then(() => {
                onClose()
                toast.success(`Pushed to ${input.host}`)
              })
              .catch((e) => {
                toast.error(`Failed to push to ${input.host}: ${e.message}`)
              })
          }}
        >
          Push to Web
        </Button> */}
        <Button
          chromeless
          size="$2"
          onPress={() => {
            if (shouldDoAlways) setDoEveryTime('never')
            onClose()
          }}
        >
          Dismiss
        </Button>
      </XStack>
    </>
  )
}
