import {MainWrapper} from '@/components/main-wrapper'
import {panelContainerStyles} from '@shm/ui/container'
import {SizableText} from '@shm/ui/text'
import {Bell} from 'lucide-react'

export default function NotificationsPage() {
  return (
    <MainWrapper>
      <div className={panelContainerStyles}>
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
          <div className="bg-muted flex h-20 w-20 items-center justify-center rounded-lg">
            <Bell size={50} className="text-muted-foreground" />
          </div>
          <SizableText size="xl">Notifications</SizableText>
          <p className="text-muted-foreground max-w-lg text-center">
            No notifications yet. Activity on your documents will appear here.
          </p>
        </div>
      </div>
    </MainWrapper>
  )
}
