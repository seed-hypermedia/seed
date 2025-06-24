import {SizableText} from '@shm/ui/text'
import {HTMLAttributes, ReactNode} from 'react'

export function AppBanner({
  children,
  ...props
}: {
  children: ReactNode
  onPress?: () => void
} & HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className="border-border animate-in slide-in-from-top-8 fade-in absolute top-0 left-0 w-full border-b bg-yellow-50 p-1 px-3 duration-200 ease-in-out select-none dark:bg-yellow-900/20"
      {...props}
    >
      {children}
    </div>
  )
}

export function BannerText(props: any) {
  return <SizableText {...props} size="xs" className="text-center" />
}
