import type { HTMLAttributes, ReactNode } from 'react'
import { widthValues } from './layout'
import { PageLayout } from './page-layout'
import { Spinner } from './spinner'
import { Text } from './text'
import { cn } from './utils'

/** GeneralPageSurface provides the shared page background for feed-like pages. */
export function GeneralPageSurface({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('dark:bg-background flex flex-1 flex-col bg-white', className)} {...props} />
}

/** GeneralPageContainer constrains and spaces feed-like page content. */
export function GeneralPageContainer({
  contentMaxWidth = widthValues.M,
  className,
  children,
}: {
  contentMaxWidth?: number
  className?: string
  children: ReactNode
}) {
  return (
    <PageLayout contentMaxWidth={contentMaxWidth}>
      <div className={cn('flex flex-col gap-4 pt-8 px-4', className)}>{children}</div>
    </PageLayout>
  )
}

/** GeneralPageHeader renders the shared title/action row for feed-like pages. */
export function GeneralPageHeader({
  title,
  loading = false,
  actions,
  className,
}: {
  title: ReactNode
  loading?: boolean
  actions?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-center justify-between gap-4', className)}>
      <div className="flex min-w-0 items-center gap-2">
        {typeof title === 'string' ? (
          <Text weight="bold" size="3xl" className="truncate">
            {title}
          </Text>
        ) : (
          title
        )}
        {loading ? <Spinner /> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}
