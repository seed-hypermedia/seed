import {createOSProtocolUrl, UnpackedHypermediaId} from '@shm/shared'
import {useTx} from '@shm/shared/translation'
import {Button} from '@shm/ui/button'
import {SizableText} from '@shm/ui/text'
import {cn} from '@shm/ui/utils'
import {ExternalLink} from 'lucide-react'
import {ReactNode} from 'react'
import {AccountFooterActions} from './auth'
import {ClientOnly} from './client-lazy'

export function PageFooter({
  id,
  hideDeviceLinkToast = false,
  className,
}: {
  id?: UnpackedHypermediaId | null
  hideDeviceLinkToast?: boolean
  className?: string
}) {
  const tx = useTx()
  return (
    <div
      className={cn(
        'border-border border-t px-3 py-2 sm:px-4 sm:py-2',
        className,
      )}
    >
      <div className="flex flex-row-reverse flex-wrap items-center justify-between gap-4">
        <ClientOnly>
          <AccountFooterActions hideDeviceLinkToast={hideDeviceLinkToast} />
        </ClientOnly>
        <div className="flex items-center gap-4">
          <SizableText size="xs">
            {tx(
              'powered_by',
              ({seedLink}: {seedLink: ReactNode}) => (
                <>Powered by {seedLink}</>
              ),
              {
                seedLink: (
                  <a
                    className="text-xs"
                    href="https://seed.hyper.media"
                    target="_blank"
                  >
                    Seed Hypermedia
                  </a>
                ),
              },
            )}
          </SizableText>
          {id ? (
            <Button
              className="hidden sm:flex"
              size="sm"
              variant="default"
              asChild
            >
              <a href={createOSProtocolUrl(id)}>
                <ExternalLink className="size-3" />
                {tx('Open App')}
              </a>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  )
}
