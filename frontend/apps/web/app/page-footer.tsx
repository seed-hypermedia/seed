import {createHMUrl, UnpackedHypermediaId} from '@shm/shared'
import {Button} from '@shm/ui/button'
import {Container} from '@shm/ui/container'
import {ButtonText} from '@tamagui/button'
import {View} from '@tamagui/core'
import {ExternalLink} from '@tamagui/lucide-icons'
import {XStack} from '@tamagui/stacks'
import {SizableText} from '@tamagui/text'
import {AccountFooterActionsLazy} from './client-lazy'

export function PageFooter({
  id,
  enableWebSigning,
}: {
  id?: UnpackedHypermediaId
  enableWebSigning?: boolean
}) {
  return (
    <Container>
      <XStack jc="space-between" ai="center">
        <XStack padding="$4" gap="$4" ai="center">
          <SizableText size="$1">
            Powered by{' '}
            <ButtonText
              size="$1"
              tag="a"
              href="https://seed.hyper.media"
              target="_blank"
            >
              Seed Hypermedia
            </ButtonText>
          </SizableText>
          {id ? (
            <Button
              tag="a"
              size="$1"
              href={createHMUrl(id)}
              style={{textDecoration: 'none'}}
              icon={ExternalLink}
              backgroundColor="$green9"
              hoverStyle={{backgroundColor: '$green8'}}
              themeInverse
              padding="$3"
            >
              Open App
            </Button>
          ) : null}
        </XStack>
        {enableWebSigning ? <AccountFooterActionsLazy /> : <View />}
      </XStack>
    </Container>
  )
}
