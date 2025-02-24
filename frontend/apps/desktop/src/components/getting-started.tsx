import {openAddAccountWizard} from '@/components/create-account'
import {useTriggerWindowEvent} from '@/utils/window-events'
import {Contact, Search} from '@tamagui/lucide-icons'
import {Button, Separator, SizableText, YStack} from 'tamagui'

export function GettingStarted() {
  const openLauncher = useTriggerWindowEvent()
  return (
    <YStack
      gap="$4"
      padding="$4"
      bg="$background"
      borderColor="$color7"
      borderWidth={1}
      borderRadius="$5"
      elevation="$2"
      marginBottom={40}
      animation="medium"
      enterStyle={{opacity: 0, y: -10}}
      exitStyle={{opacity: 0, y: -10}}
    >
      <SizableText size="$8" fontWeight="bold">
        Lets Get Started!
      </SizableText>
      <SizableText>
        Welcome to Seed Hypermedia. Ready to enhance the web?
      </SizableText>
      <SizableText>
        You can Start by creating your first account. it's quick and easy and it
        will unlock all the features of Seed Hypermedia.
      </SizableText>
      <Button
        bg="$brand11"
        borderColor="$brand10"
        hoverStyle={{bg: '$brand12', borderColor: '$brand11'}}
        icon={<Contact color="currentColor" />}
        onPress={openAddAccountWizard}
      >
        Add Account
      </Button>
      <Separator />
      <SizableText size="$7" fontWeight="bold">
        Got a Seed Hypermedia Link?
      </SizableText>
      <SizableText>
        If you got a Seed Hypermedia link, you can add it here.
      </SizableText>
      <Button
        bg="$brand11"
        borderColor="$brand10"
        hoverStyle={{bg: '$brand12', borderColor: '$brand11'}}
        icon={Search}
        onPress={() => openLauncher('openLauncher')}
      >
        Open Document
      </Button>
    </YStack>
  )
}
