import {useWindowUtils} from '@/app-context'
import {Button} from '@shm/ui/components/button'
import {X} from 'lucide-react'

export function CloseButton() {
  const {close} = useWindowUtils()
  return (
    <ButtonWrapper aria-label="close" tabIndex={-1} onClick={close}>
      <X className="size-3" />
    </ButtonWrapper>
  )
}

export function MaximizeOrRestoreButton() {
  const {isMaximized, maximize, unmaximize} = useWindowUtils()

  if (isMaximized === undefined) return null

  let name: string
  let path: string
  let cb

  if (isMaximized) {
    name = 'restore'
    path =
      'm 2,1e-5 0,2 -2,0 0,8 8,0 0,-2 2,0 0,-8 z m 1,1 6,0 0,6 -1,0 0,-5 -5,0 z m -2,2 6,0 0,6 -6,0 z'
    cb = unmaximize
  } else {
    name = 'maximize'
    path = 'M 0,0 0,10 10,10 10,0 Z M 1,1 9,1 9,9 1,9 Z'
    cb = maximize
  }

  const title = name[0].toUpperCase() + name.substring(1)

  return (
    <ButtonWrapper aria-label={name} title={title} tabIndex={-1} onClick={cb}>
      <svg
        aria-hidden="true"
        version="1.1"
        viewBox="0 0 10 10"
        className="size-2"
      >
        <path fill="currentColor" d={path} />
      </svg>
    </ButtonWrapper>
  )
}

export function MinimizeButton() {
  const {minimize} = useWindowUtils()

  return (
    <ButtonWrapper aria-label="minize" tabIndex={-1} onClick={minimize}>
      <svg
        aria-hidden="true"
        viewBox="0 0 10 10"
        width={10}
        height={10}
        className="size-3"
      >
        <path fill="currentColor" d="M 0,5 10,5 10,6 0,6 Z" />
      </svg>
    </ButtonWrapper>
  )
}

function ButtonWrapper(props: any) {
  return <Button size="iconSm" variant="ghost" {...props} />
}

export function WindowsLinuxWindowControls() {
  return (
    <div className="flex gap-1 pr-3 no-window-drag">
      <MinimizeButton />
      <MaximizeOrRestoreButton />
      <CloseButton />
    </div>
  )
}
