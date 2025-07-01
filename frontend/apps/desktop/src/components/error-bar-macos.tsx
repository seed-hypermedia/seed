import {TitlebarWrapper} from '@shm/ui/titlebar'
import {AlertCircle} from 'lucide-react'
import {NavMenuButton, NavigationButtons} from './titlebar-common'

export default function ErrorBar() {
  return (
    <TitlebarWrapper>
      <div className="flex justify-between">
        <div className="flex items-center gap-2">
          <NavMenuButton />
          <NavigationButtons />
        </div>
        <div className="flex flex-1 items-center justify-center">
          <AlertCircle className="text-destructive size-3" />
        </div>
      </div>
    </TitlebarWrapper>
  )
}
