import {createHMUrl, UnpackedHypermediaId} from '@shm/shared'
import {Button} from '@shm/ui/components/button'
import {Container} from '@shm/ui/container'
import {ExternalLink} from '@shm/ui/icons'
import {ButtonText} from '@tamagui/button'
import {View} from '@tamagui/core'
import {XStack} from '@tamagui/stacks'
import {SizableText} from '@tamagui/text'
import {AccountFooterActionsLazy} from './client-lazy'

export function PageFooter({
  id,
  enableWebSigning,
}: {
  id?: UnpackedHypermediaId | null
  enableWebSigning?: boolean
}) {
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
              Open App
            </Button>
          ) : null}
        </XStack>
      </XStack>
    </Container>
  )
}
