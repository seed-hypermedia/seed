import {eventStream} from '@shm/shared/utils/stream'
import {useEffect, useState} from 'react'
import {Dialog, SizableText, YStack} from 'tamagui'

export const [dispatchSiteTemplateEvent, siteTemplateEvents] =
  eventStream<boolean>()

export function SiteTemplate() {
  return (
    <YStack>
      <SizableText>Site Template</SizableText>
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
        <Dialog.Content>
          <SizableText>Site Template</SizableText>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}
