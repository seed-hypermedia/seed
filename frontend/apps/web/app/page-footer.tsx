import {createHMUrl, UnpackedHypermediaId} from '@shm/shared'
import {useTx} from '@shm/shared/translation'
import {Button} from '@shm/ui/button'
import {SizableText} from '@shm/ui/text'
import {ExternalLink} from 'lucide-react'
import {ReactNode} from 'react'
import {AccountFooterActionsLazy} from './client-lazy'

export function PageFooter({
  id,
  enableWebSigning,
}: {
  id?: UnpackedHypermediaId | null
  enableWebSigning?: boolean
}) {
  const tx = useTx()
  return (
    <div className="border-border mb-11 border-t p-2 sm:mb-0 sm:px-4 sm:py-2">
      <div className="flex flex-row-reverse flex-wrap items-center justify-between gap-4">
        {enableWebSigning ? <AccountFooterActionsLazy /> : <div />}
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
