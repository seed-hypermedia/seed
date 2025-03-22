import {MainWrapper} from '@/components/main-wrapper'
import {Container} from '@shm/ui/container'
import {Text, XStack} from 'tamagui'

export default function DraftsPage() {
  return (
    <XStack flex={1} height="100%">
      <MainWrapper>
        <Container justifyContent="center" centered>
          <Text>Drafts</Text>
        </Container>
      </MainWrapper>
    </XStack>
  )
}
