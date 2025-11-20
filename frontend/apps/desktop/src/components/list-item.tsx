import {FavoriteButton} from '@/components/favoriting'

import {LibraryData, LibraryDependentData} from '@/models/library'
import {useNavigate} from '@/utils/useNavigate'
import {Timestamp} from '@bufbuild/protobuf'
import {getMetadataName} from '@shm/shared/content'
import {DocumentRoute} from '@shm/shared/routes'
import {useHover} from '@shm/shared/use-hover'
import {formattedDate, formattedDateLong} from '@shm/shared/utils/date'
import {Button, ButtonProps} from '@shm/ui/button'
import {Checkbox} from '@shm/ui/components/checkbox'
import {HMIcon} from '@shm/ui/hm-icon'
import {MenuItemType, OptionsDropdown} from '@shm/ui/options-dropdown'
import {SizableText} from '@shm/ui/text'
import {Tooltip} from '@shm/ui/tooltip'
import {ReactElement, useMemo, useState} from 'react'
import {GestureResponderEvent} from 'react-native'

export function ListItem({
  accessory,
  title,
  onClick,
  icon,
  onPointerEnter,
  menuItems = [],
  active,
}: {
  accessory?: ReactElement
  icon?: ReactElement
  title: string
  onClick: ButtonProps['onClick']
  onPointerEnter?: () => void
  menuItems?: (MenuItemType | null)[] | (() => (MenuItemType | null)[])
  active?: boolean
}) {
  let {hover, ...hoverProps} = useHover()
  const [currentMenuItems, setMenuItems] = useState(
    typeof menuItems === 'function' ? undefined : menuItems,
  )
  return (
    <div className="group flex w-full max-w-[900px] py-2">
      <Button
        onPointerEnter={() => {
          onPointerEnter?.()
          if (!currentMenuItems && typeof menuItems === 'function') {
            setMenuItems(menuItems())
          }
        }}
        variant={active ? 'secondary' : 'ghost'}
        onClick={onClick}
        {...hoverProps}
        className="hover:bg-accent hover:border-background w-full max-w-[600px] flex-1 justify-start"
      >
        {icon}
        <span
          onClick={(e) => {
            e.stopPropagation()
            onClick?.(e as any)
          }}
          className="flex-[2] text-left font-bold"
        >
          {title}
        </span>
        {accessory && (
          <div className="flex flex-shrink-0 gap-2 px-2">{accessory}</div>
        )}
        {currentMenuItems && currentMenuItems.length ? (
          <div
            className={`${
              hover ? 'opacity-100' : 'opacity-0'
            } group-hover:opacity-100`}
          >
            <OptionsDropdown hover={hover} menuItems={currentMenuItems} />
          </div>
        ) : (
          <div className="w-5" />
        )}
      </Button>
    </div>
  )
}

export function TimeAccessory({
  time,
  onPress,
  tooltipLabel,
}: {
  time: Timestamp | undefined
  onPress: (e: GestureResponderEvent) => void
  tooltipLabel?: string
}) {
  return (
    <Tooltip
      content={
        tooltipLabel
          ? `${tooltipLabel} ${formattedDateLong(time)}`
          : formattedDateLong(time)
      }
    >
      <button
        className="min-w-10 justify-end text-right text-sm"
        data-testid="list-item-date"
        onClick={onPress as any}
      >
        {time ? formattedDate(time) : '...'}
      </button>
    </Tooltip>
  )
}

export function LibraryListItem({
  entry,
  exportMode,
  selected,
  docId,
  toggleDocumentSelection,
}: {
  entry: LibraryData['items'][number]
  exportMode: boolean
  selected: boolean
  toggleDocumentSelection: (id: string) => void
  docId: string
}) {
  const navigate = useNavigate()
  // @ts-expect-error
  const metadata = entry.document?.metadata || entry.draft?.metadata
  // @ts-expect-error
  const isUnpublished = !!entry.draft && !entry.document
  const editors = useMemo(
    () =>
      entry.authors.length > 3 ? entry.authors.slice(0, 2) : entry.authors,
    [entry.authors],
  )

  const icon =
    entry.id.path?.length == 0 || entry.document?.metadata.icon ? (
      <HMIcon
        size={28}
        id={entry.id}
        // @ts-expect-error
        metadata={entry.document?.metadata || entry.draft?.metadata}
      />
    ) : null

  return (
    <div
      onClick={() => {
        if (!exportMode) {
          navigate({key: 'document', id: entry.id})
        }
        // else {
        //   toggleDocumentSelection(entry.id.id)
        // }
      }}
      // this data attribute is used by the hypermedia highlight component
      data-resourceid={docId}
      className={`group hover:bg-accent flex h-[60px] w-full cursor-pointer items-center justify-start border-0 bg-transparent px-4 py-1 shadow-sm transition-colors`}
    >
      {exportMode ? (
        <div className="flex items-center gap-3">
          {exportMode && (
            <Checkbox
              checked={selected}
              onCheckedChange={() => {
                toggleDocumentSelection(entry.id.id)
              }}
            />
          )}
          {icon}
        </div>
      ) : (
        icon
      )}
      <div className="flex flex-1 items-center gap-2 py-2">
        <div className="flex flex-1 flex-col gap-1.5">
          <div className="flex items-center gap-2 overflow-hidden pl-1">
            <SizableText weight="bold" className="truncate">
              {getMetadataName(metadata)}
            </SizableText>
            {isUnpublished && (
              <span className="rounded border border-yellow-400 bg-yellow-100 px-2 py-1 text-xs text-yellow-500 dark:bg-yellow-900 dark:text-yellow-300">
                Unpublished
              </span>
            )}
          </div>
          {entry.location.length ? (
            <LibraryEntryLocation
              location={entry.location}
              onNavigate={navigate}
            />
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-3">
        {isUnpublished ? null : (
          <FavoriteButton id={entry.id} hideUntilItemHover />
        )}

        <LibraryEntryTime entry={entry} />

        <div className="flex">
          {editors.map((author, idx) => (
            <div
              key={author.id.id}
              className="border-background bg-background group-hover:border-accent group-hover:bg-accent -ml-2 overflow-hidden rounded-full border-2 transition-all duration-200"
              style={{zIndex: idx + 1}}
            >
              <HMIcon
                id={author.id}
                name={author.metadata?.name}
                icon={author.metadata?.icon}
                size={20}
              />
            </div>
          ))}
          {entry.authors.length > editors.length && editors.length != 0 ? (
            <div className="border-background bg-background z-1 -ml-2 flex h-6 w-6 items-center justify-center rounded-full border-2 transition-all duration-200">
              <span className="text-muted-foreground text-[10px] font-bold">
                +{entry.authors.length - editors.length - 1}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function LibraryEntryTime({entry}: {entry: LibraryData['items'][number]}) {
  return (
    <SizableText size="xs" color="muted">
      {/* @ts-expect-error */}
      {formattedDate(entry.updateTime)}
    </SizableText>
  )
}

function LibraryEntryLocation({
  location,
  onNavigate,
}: {
  location: LibraryDependentData[]
  onNavigate: (route: DocumentRoute) => void
}) {
  const [space, ...names] = location
  return (
    <div className="flex w-full gap-2 overflow-hidden">
      <Button
        variant="ghost"
        size="xs"
        className="text-primary hover:text-primary/80 h-auto border-0 bg-transparent p-0 font-normal hover:bg-transparent hover:underline"
        onClick={(e) => {
          e.stopPropagation()
          {
            /* @ts-ignore */
          }
          onNavigate({key: 'document', id: space.id})
        }}
      >
        {/* @ts-ignore */}
        {getMetadataName(space.metadata)}
      </Button>

      {names.length ? (
        <>
          <span className="text-muted-foreground text-xs">|</span>
          <div className="flex items-center gap-0.5">
            {names.map(({id, metadata}, idx) => (
              <>
                {idx != 0 ? (
                  <span
                    key={`slash-${id.id}`}
                    className="text-muted-foreground text-xs"
                  >
                    /
                  </span>
                ) : null}
                <Button
                  key={id.id}
                  variant="ghost"
                  size="xs"
                  className="text-muted-foreground h-auto border-0 bg-transparent p-0 hover:bg-transparent hover:underline"
                  onClick={(e) => {
                    e.stopPropagation()
                    onNavigate({key: 'document', id})
                  }}
                >
                  {metadata
                    ? getMetadataName(metadata)
                    : id.path?.at(-1) || 'Untitled'}
                </Button>
              </>
            ))}
          </div>
        </>
      ) : null}
    </div>
  )
}
