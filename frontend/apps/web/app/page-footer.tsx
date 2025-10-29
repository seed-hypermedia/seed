import {createHMUrl, UnpackedHypermediaId} from '@shm/shared'
import {useTx} from '@shm/shared/translation'
import {Button} from '@shm/ui/button'
import {SizableText} from '@shm/ui/text'
import {ExternalLink} from 'lucide-react'
import {ReactNode} from 'react'

export function PageFooter({
  id,
  hideDeviceLinkToast = false,
}: {
  id?: UnpackedHypermediaId | null
  hideDeviceLinkToast?: boolean
}) {
  const tx = useTx()
  return (
    <div className="border-border border-t px-3 py-2 sm:px-4 sm:py-2">
      <div className="flex flex-row-reverse flex-wrap items-center justify-between gap-4">
        {/* <ClientOnly>
          <AccountFooterActions hideDeviceLinkToast={hideDeviceLinkToast} />
        </ClientOnly> */}
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
              onClick={() => {
                createHMUrl(id)
              }}
              asChild
            >
              <a href={createHMUrl(id)}>
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
