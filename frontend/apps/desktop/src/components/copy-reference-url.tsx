import {usePublishToSite} from '@/models/documents'
import {UnpackedHypermediaId} from '@shm/shared'
import {createWebHMUrl, packHmId} from '@shm/shared/utils/entity-id-url'
import {StateStream, writeableStateStream} from '@shm/shared/utils/stream'
import {Button} from '@shm/ui/button'
import {CheckboxField} from '@shm/ui/components/checkbox'
import {copyTextToClipboard} from '@shm/ui/copy-to-clipboard'
import {Spinner} from '@shm/ui/spinner'
import {toast} from '@shm/ui/toast'
import {useStream} from '@shm/ui/use-stream'
import {ReactNode, useState} from 'react'
import {
  usePushOnCopy,
  useSetPushOnCopy,
  useSetPushOnPublish,
} from '../models/gateway-settings'
import {NavigationContext} from '../utils/navigation'
import {DialogDescription, DialogTitle, useAppDialog} from './dialog'
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
    const url = createWebHMUrl(input.uid, {
      version: input.version,
      blockRef: input.blockRef,
      blockRange: input.blockRange,
      hostname,
      path: input.path,
      latest: input.latest,
      originHomeId,
    })
    copyTextToClipboard(url)
    if (pushOnCopy.data === 'never') {
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
  const entityType = 'Document'
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
      <div className="flex gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (shouldDoAlways) setDoEveryTime('never')
            onClose()
          }}
        >
          Dismiss
        </Button>
      </div>
    </>
  )
}
