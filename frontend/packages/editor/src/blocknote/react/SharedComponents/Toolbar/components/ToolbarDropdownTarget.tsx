import {Button} from '@mantine/core'
import {ChevronDown} from '@shm/ui/icons'
import {MouseEventHandler, forwardRef} from 'react'
import {IconType} from 'react-icons'

export type ToolbarDropdownTargetProps = {
  text: string
  icon?: IconType
  isDisabled?: boolean
  onClick?: MouseEventHandler
}

export const ToolbarDropdownTarget = forwardRef<
  HTMLButtonElement,
  ToolbarDropdownTargetProps
>((props: ToolbarDropdownTargetProps, ref) => {
  const TargetIcon = props.icon
  return (
    <Button
      leftIcon={TargetIcon && <TargetIcon size={16} />}
      rightIcon={<ChevronDown />}
      size={'xs'}
      variant={'subtle'}
      disabled={props.isDisabled}
      onClick={props.onClick}
      ref={ref}
    >
      {props.text}
    </Button>
  )
})
