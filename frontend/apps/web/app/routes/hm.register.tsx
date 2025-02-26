import {defaultPageMeta} from '@/meta'
import {XStack, YStack} from '@tamagui/stacks'
import {SizableText} from '@tamagui/text'
import {Container} from '../ui/container'

export const loader = async ({request}: {request: Request}) => {
  return null
}

export const meta = defaultPageMeta('Site Registration')

export default function RegisterPage() {
  return (
    <YStack>
      <Container>
        <YStack
          alignSelf="center"
          width={600}
          gap="$5"
          borderWidth={1}
          borderColor="$color8"
          borderRadius="$4"
          padding="$5"
          elevation="$4"
        >
          <XStack alignItems="center" gap="$3">
            <SizableText size="$10">🚀</SizableText>
            <SizableText size="$8" fontWeight="bold">
              Secret Site Setup Link
            </SizableText>
          </XStack>
          <YStack gap="$3">
            <SizableText>
              <b>Your Seed Hypermedia Site is Ready to be Deployed!</b>
            </SizableText>
            <SizableText>
              From your publication or account page within the Seed Hypermedia
              app, click the dropdown in the top right corner and select
              "Publish Site". Then, paste the URL of this page into the dialog
              box, and click Publish!
            </SizableText>
            <SizableText>
              Then your content will be published to this site. Your account
              will be registered in this domain, so all future content in your
              publication will be sent here and published to the web.
            </SizableText>
            <SizableText>
              <b>Warning:</b> You should keep this URL a secret, otherwise
              somebody else might publish their content here before you do.
            </SizableText>
          </YStack>
        </YStack>
      </Container>
    </YStack>
  )
}
