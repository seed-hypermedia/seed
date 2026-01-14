import {unpackHmId} from '@shm/shared'
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
import {useHighlighter} from './highlight-context'
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
  accessory,
  textClass,
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
  accessory?: ReactNode
  textClass?: string
}) {
  const indent = indented ? (typeof indented === 'number' ? indented : 1) : 0
  const highlighter = useHighlighter()

  return (
    <Button
      className={cn(
        'user-select-none group h-auto min-h-8 w-full px-2 text-left outline-none',
        active && 'bg-accent text-accent-foreground',
        multiline && 'whitespace-normal!',
        props.className,
      )}
      size="sm"
      style={{
        paddingLeft: Math.max(0, indent) * 22 + 12,
      }}
      {...(docId ? highlighter(unpackHmId(docId)!) : {})}
      {...props}
    >
      <div className="flex flex-1 items-start gap-2 overflow-hidden">
        {isValidElement(icon) ? (
          <div className="pt-0.5">{icon}</div>
        ) : icon ? (
          <div className="size-4 flex-none shrink-0 pt-0.5">
            {/* @ts-expect-error */}
            {createElement(icon, {
              size: 18,
              color: color || 'currentColor',
            })}
          </div>
        ) : null}
        {children}

        <div className="flex flex-1 items-center gap-1.5 overflow-hidden">
          <SizableText
            size="sm"
            className={cn(
              `${
                multiline ? 'line-clamp-2' : 'truncate whitespace-nowrap'
              } mobile-menu-item-label text-left select-none`.trim(),
              bold && 'font-bold',
              textClass,
            )}
            style={{
              color: typeof color === 'string' ? color : undefined,
            }}
          >
            {title}
          </SizableText>
          {isDraft ? <DraftBadge /> : null}
          {accessory}
        </div>
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
