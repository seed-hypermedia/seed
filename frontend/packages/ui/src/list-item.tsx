import {ArrowDownRight, ChevronDown, ChevronRight} from 'lucide-react'
import {
  ComponentProps,
  createElement,
  isValidElement,
  ReactNode,
  useState,
} from 'react'
import {Button, ButtonProps} from './button'
import {DraftBadge} from './draft-badge'
import {MenuItemType, OptionsDropdown} from './options-dropdown'
import {SizableText} from './text'
import {Tooltip} from './tooltip'
import {cn} from './utils'

export function FocusButton({
  onPress,
  label,
}: {
  onPress: () => void
  label?: string
}) {
  return (
    <Tooltip content={label ? `Focus ${label}` : 'Focus'}>
      <Button
        onClick={(e) => {
          e.stopPropagation()
          onPress()
        }}
        size="sm"
      >
        <ArrowDownRight className="size-3" />
      </Button>
    </Tooltip>
  )
}

export function SmallCollapsableListItem({
  children,
  ...props
}: ComponentProps<typeof SmallListItem>) {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const displayChildren = isCollapsed ? null : children
  return (
    <>
      <SmallListItem
        isCollapsed={isCollapsed}
        onSetCollapsed={setIsCollapsed}
        {...props}
      />
      {displayChildren}
    </>
  )
}

export function SmallListItem({
  disabled,
  title,
  icon,
  active,
  iconAfter,
  children,
  indented,

  bold,
  rightHover,
  color,
  menuItems,
  isCollapsed,
  onSetCollapsed,
  isDraft,
  multiline = false,
  docId,
  ...props
}: ButtonProps & {
  active?: boolean
  bold?: boolean
  indented?: boolean | number
  icon?: React.ReactNode
  iconAfter?: React.ReactNode
  selected?: boolean
  rightHover?: ReactNode[]
  menuItems?: MenuItemType[]
  isCollapsed?: boolean | null
  onSetCollapsed?: (collapsed: boolean) => void
  isDraft?: boolean
  multiline?: boolean
  docId?: string
}) {
  const indent = indented ? (typeof indented === 'number' ? indented : 1) : 0

  return (
    <Button
      className={cn(
        'user-select-none group h-auto min-h-8 w-full px-2 text-left outline-none',
        active && 'bg-secondary text-secondary-foreground',
        multiline && 'whitespace-normal!',
        props.className,
      )}
      size="sm"
      style={{
        paddingLeft: Math.max(0, indent) * 22 + 12,
      }}
      // this data attribute is used by the hypermedia highlight component
      data-docid={docId}
      {...props}
    >
      <div className="flex flex-1 items-center gap-2 overflow-hidden">
        {isValidElement(icon) ? (
          icon
        ) : icon ? (
          <div className="size-4 flex-none shrink-0">
            {createElement(icon, {
              size: 18,
              color: color || 'currentColor',
            })}
          </div>
        ) : null}
        {children}

        <SizableText
          size="sm"
          className={cn(
            `flex-1 ${
              multiline ? 'line-clamp-2' : 'truncate whitespace-nowrap'
            } mobile-menu-item-label w-full text-left select-none`.trim(),
            bold && 'font-bold',
          )}
          style={{
            color: typeof color === 'string' ? color : undefined,
          }}
        >
          {title}
        </SizableText>
        {isDraft ? <DraftBadge /> : null}
      </div>
      {isCollapsed != null ? (
        <Button
          className="absolute -left-6"
          size="sm"
          onClick={(e) => {
            e.stopPropagation()
            e.preventDefault()
            onSetCollapsed?.(!isCollapsed)
          }}
        >
          {isCollapsed ? (
            <ChevronRight className="size-3" />
          ) : (
            <ChevronDown className="size-3" />
          )}
        </Button>
      ) : null}

      {iconAfter || rightHover || menuItems ? (
        <>
          {rightHover ? (
            <div className="flex opacity-0 group-hover:opacity-100">
              {rightHover}
            </div>
          ) : null}
          {menuItems ? (
            <OptionsDropdown hiddenUntilItemHover menuItems={menuItems} />
          ) : null}
        </>
      ) : null}
    </Button>
  )
}

export function SmallListGroupItem({
  items,
  defaultExpanded,
  ...props
}: {
  items: ReactNode[]
  defaultExpanded?: boolean
} & ComponentProps<typeof SmallListItem>) {
  const [isCollapsed, setIsCollapsed] = useState(defaultExpanded ? false : true)
  return (
    <>
      <SmallListItem
        {...props}
        isCollapsed={items.length ? isCollapsed : null}
        onSetCollapsed={setIsCollapsed}
      />
      {isCollapsed ? null : items}
    </>
  )
}
