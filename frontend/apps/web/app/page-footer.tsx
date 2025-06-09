import {createHMUrl, UnpackedHypermediaId} from '@shm/shared'
import {useTx} from '@shm/shared/translation'
import {Button} from '@shm/ui/button'
import {Container} from '@shm/ui/container'
import {SizableText} from '@shm/ui/text'
import {ButtonText} from '@tamagui/button'
import {View} from '@tamagui/core'
import {ExternalLink} from '@tamagui/lucide-icons'
import {XStack} from '@tamagui/stacks'
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
    <Container className="shrink-0">
      <XStack
        jc="space-between"
        ai="center"
        flexWrap="wrap"
        flexDirection="row-reverse"
        marginBottom="$4"
        gap="$4"
      >
        {enableWebSigning ? <AccountFooterActionsLazy /> : <View />}
        <XStack gap="$4" ai="center">
          <SizableText size="xs">
            {tx(
              'powered_by',
              ({seedLink}: {seedLink: ReactNode}) => (
                <>Powered by {seedLink}</>
              ),
              {
                seedLink: (
                  <ButtonText
                    size="$1"
                    tag="a"
                    href="https://seed.hyper.media"
                    target="_blank"
                  >
                    Seed Hypermedia
                  </ButtonText>
                ),
              },
            )}
          </SizableText>
          {id ? (
            <Button
              display="none"
              $gtSm={{display: 'flex'}}
              tag="a"
              size="$2"
              href={createHMUrl(id)}
              style={{textDecoration: 'none'}}
              icon={ExternalLink}
              backgroundColor="$green4"
              hoverStyle={{backgroundColor: '$green5'}}
              themeInverse
            >
              {tx('Open App')}
            </Button>
          ) : null}
        </XStack>
      </XStack>
    </Container>
  )
}
