import {
  AnyTimestamp,
  formattedDateShort,
  NavRoute,
  normalizeDate,
  useRouteLink,
} from '@shm/shared'
import {HMContactItem} from '@shm/shared/dist/account-utils'
import {Tooltip} from './tooltip'

function formatUTC(date: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')

  const year = date.getUTCFullYear()
  const month = pad(date.getUTCMonth() + 1) // Months are 0-based.
  const day = pad(date.getUTCDate())
  const hours = pad(date.getUTCHours())
  const minutes = pad(date.getUTCMinutes())

  return `${year}-${month}-${day} ${hours}:${minutes} (UTC)`
}

export function Timestamp({
  time,
  route,
}: {
  time: AnyTimestamp
  route?: NavRoute | null
}) {
  if (!time) return null

  const linkProps = route ? useRouteLink(route ?? null) : {}
  const date = normalizeDate(time)

  if (!date) return null

  return (
    <Tooltip side="top" delay={400} content={formatUTC(date)}>
      <a {...linkProps} className="ml-1 flex-none text-[11px] hover:underline">
        {formattedDateShort(time)}
      </a>
    </Tooltip>
  )
}

export function InlineDescriptor({children}: {children: React.ReactNode}) {
  return <p className="text-muted-foreground text-sm">{children}</p>
}

export function AuthorNameLink({author}: {author: HMContactItem | null}) {
  const authorName = author?.metadata?.name || 'Someone'
  const linkProps = useRouteLink(
    author?.id ? {key: 'profile', id: author.id} : null,
  )
  return (
    <a className="text-foreground text-sm font-bold" {...linkProps}>
      {authorName}
    </a>
  )
}
