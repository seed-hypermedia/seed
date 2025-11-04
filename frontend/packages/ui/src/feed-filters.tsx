import _ from 'lodash'
import {Button, ButtonProps} from './button'
import {Tooltip} from './tooltip'
import {cn} from './utils'

export function FeedFilters({
  filterEventType,
  onFilterChange,
}: {
  onFilterChange: any
  filterEventType?: Array<string>
}) {
  return (
    <div className="-mx-1 flex gap-2 py-2">
      <PredefinedFilter
        className={cn(
          _.isEqual(filterEventType, ['Comment']) &&
            'border-black/15 bg-black/10 hover:border-black/20 hover:bg-black/15 dark:border-white/15 dark:bg-white/10 dark:hover:border-white/20 hover:dark:bg-white/15',
        )}
        onClick={() => onFilterChange({filterEventType: ['Comment']})}
      >
        Discussions
      </PredefinedFilter>
      <PredefinedFilter
        className={cn(
          _.isEqual(filterEventType, ['Ref']) &&
            'border-black/15 bg-black/10 hover:border-black/20 hover:bg-black/15 dark:border-white/15 dark:bg-white/10 dark:hover:border-white/20 hover:dark:bg-white/15',
        )}
        onClick={() => onFilterChange({filterEventType: ['Ref']})}
      >
        Updates
      </PredefinedFilter>
      <PredefinedFilter
        className={cn(
          _.isEqual(filterEventType, [
            'comment/Embed',
            'doc/Embed',
            'doc/Link',
            'doc/Button',
          ]) &&
            'border-black/15 bg-black/10 hover:border-black/20 hover:bg-black/15 dark:border-white/15 dark:bg-white/10 dark:hover:border-white/20 hover:dark:bg-white/15',
        )}
        onClick={() =>
          onFilterChange({
            filterEventType: [
              'comment/Embed',
              'doc/Embed',
              'doc/Link',
              'doc/Button',
            ],
          })
        }
      >
        Citation
      </PredefinedFilter>
      {!!filterEventType && filterEventType?.length != 0 ? (
        <Tooltip content="Clear Filters">
          <Button
            size="xs"
            className="opacity-50"
            variant="ghost"
            onClick={() => onFilterChange([])}
          >
            clear
          </Button>
        </Tooltip>
      ) : null}
      {/* <MoreFilters /> */}
    </div>
  )
}

function PredefinedFilter({className, ...props}: ButtonProps) {
  return (
    <Button className={cn(className)} size="xs" variant="outline" {...props}>
      {props.children}
    </Button>
  )
}

// function MoreFilters() {
//   return (
//     <PredefinedFilter variant="ghost">
//       <Plus className="size-3" />
//       Filter
//       <Badge variant="default">3</Badge>
//     </PredefinedFilter>
//   )
// }
