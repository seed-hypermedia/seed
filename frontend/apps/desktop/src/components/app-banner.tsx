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
      className="bg-yellow-50 dark:bg-yellow-900/20 w-full absolute top-0 left-0 p-1 border-b border-border px-3 select-none animate-in slide-in-from-top-8 fade-in duration-200 ease-in-out"
      {...props}
    >
      {children}
    </div>
  )
}

export function BannerText(props: any) {
  return <SizableText {...props} size="xs" className="text-center" />
}
