import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu'
import {Button, ButtonProps} from '@shm/ui/button'
import {MenuItem} from '@shm/ui/menu-item'
import {forwardRef} from 'react'
import {ListItemProps, SizableText, SizableTextProps} from 'tamagui'
import {DialogOverlay} from './dialog'

const Content = ({
  children,
  ...props
}: DropdownMenuPrimitive.DropdownMenuContentProps) => {
  return (
    <DropdownMenuPrimitive.Content asChild {...props}>
      <div
        //@ts-ignore
        contentEditable={false}
        className="bg-background z-[5] min-w-[220px] overflow-hidden rounded-md shadow-lg"
      >
        {children}
      </div>
    </DropdownMenuPrimitive.Content>
  )
}

const SubContent = forwardRef<
  any,
  DropdownMenuPrimitive.DropdownMenuSubContentProps
>(({children, ...props}, ref) => {
  return (
    <DropdownMenuPrimitive.SubContent asChild {...props}>
      <div
        ref={ref}
        //@ts-ignore
        contentEditable={false}
        className="bg-background z-[5] min-w-[300px] overflow-hidden rounded-md shadow-lg"
      >
        {children}
      </div>
    </DropdownMenuPrimitive.SubContent>
  )
})

var RightSlot = SizableText

export const ElementDropdown = forwardRef<any, ButtonProps>(
  ({onClick, ...props}, ref) => {
    return (
      <DropdownMenuPrimitive.Trigger asChild ref={ref}>
        <Button size="sm" onClick={onClick} {...props} />
      </DropdownMenuPrimitive.Trigger>
    )
  },
)

export const SubTrigger = forwardRef<any, SizableTextProps>((props, ref) => {
  return (
    <DropdownMenuPrimitive.SubTrigger asChild ref={ref}>
      <SizableText
        outlineStyle="none"
        backgroundColor="$background"
        paddingHorizontal="$4"
        paddingVertical="$2"
        outlineColor="transparent"
        {...props}
        // onPress={props.onSelect}
      />
    </DropdownMenuPrimitive.SubTrigger>
  )
})

function Label(props: SizableTextProps) {
  return (
    <DropdownMenuPrimitive.Label asChild>
      <SizableText
        outlineStyle="none"
        backgroundColor="$background"
        size="$1"
        paddingHorizontal="$4"
        outlineColor="transparent"
        {...props}
      />
    </DropdownMenuPrimitive.Label>
  )
}

const Item = forwardRef<
  any,
  Omit<DropdownMenuPrimitive.DropdownMenuItemProps, 'onSelect'> & {
    iconAfter?: ListItemProps['iconAfter']
    icon?: ListItemProps['icon']
    onPress: ListItemProps['onPress']
  }
>(({children, title, icon, iconAfter, disabled, ...props}, ref) => {
  return (
    <DropdownMenuPrimitive.Item
      ref={ref}
      {...props}
      disabled={disabled}
      asChild
    >
      <MenuItem
        title={title}
        icon={icon}
        iconAfter={iconAfter}
        disabled={disabled}
      >
        {children}
      </MenuItem>
    </DropdownMenuPrimitive.Item>
  )
})

export const Dropdown = {
  ...DropdownMenuPrimitive,
  // Content,
  Overlay: DialogOverlay,
  Trigger: ElementDropdown,
  Label,
  Content,
  SubContent,
  Item,

  SubTrigger,
  // Separator: StyledSeparator,
  RightSlot,
}
