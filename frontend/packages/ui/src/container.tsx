import {cn} from './utils'

export function PanelContainer({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className="h-full w-full px-2">
      <div
        className={cn(
          'dark:bg-background sm:border-border h-full overflow-hidden bg-white sm:rounded-md sm:border',
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </div>
  )
}

export const Container = ({
  className,
  clearVerticalSpace = false,
  centered = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  hide?: boolean
  clearVerticalSpace?: boolean
  centered?: boolean
}) => {
  return (
    <div
      className={cn(
        'mx-auto w-full flex-shrink-0 px-4 pt-6',
        props.hide && 'pointer-events-none opacity-0',
        clearVerticalSpace && 'py-0',
        centered && 'max-w-[calc(85ch+1em)]',
        className,
      )}
      {...props}
    />
  )
}

export const windowContainerStyles = cn(
  'flex flex-col w-screen h-screen min-h-svh bg-background dark:bg-black p-2',
)

export const panelContainerStyles = cn(
  'flex flex-col w-full h-full bg-background dark:bg-black border border-border rounded-md overflow-hidden bg-white dark:bg-background',
)
