import {
  Button,
  Close,
  Menu,
  ScrollView,
  Search,
  SizableText,
  UIAvatar,
  XStack,
  YStack,
} from '@shm/ui'
import {useState} from 'react'

export function Topbar({children}: {children: React.ReactNode}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <XStack
        paddingHorizontal="$4"
        paddingVertical="$2.5"
        ai="center"
        borderBottomWidth={1}
        borderColor="$borderColor"
        gap="$4"
      >
        <XStack ai="center" gap="$2">
          <UIAvatar size={24} label="Hello world" />
          <SizableText fontWeight="bold">Hello world</SizableText>
        </XStack>
        <XStack f={1} />
        <Button
          $gtSm={{display: 'none'}}
          icon={<Menu size={20} />}
          chromeless
          size="$2"
          onPress={() => {
            console.log(`== ~ Topbar ~ onPress: open:`, open)
            setOpen(true)
          }}
        />
        <Button
          display="none"
          $gtSm={{display: 'flex'}}
          icon={<Search size={20} />}
          chromeless
          size="$2"
        />
      </XStack>
      <MobileMenu open={open} onClose={() => setOpen(false)}>
        {children}
      </MobileMenu>
    </>
  )
}

export function NewspaperTopbar({children}: {children: React.ReactNode}) {
  const [open, setOpen] = useState(false)

  console.log(`== ~ Topbar ~ open:`, open)
  return (
    <>
      <YStack borderBottomWidth={1} borderColor="$borderColor">
        <XStack
          paddingHorizontal="$4"
          paddingVertical="$2.5"
          ai="center"
          gap="$4"
        >
          <XStack w={38} />
          <XStack f={1} />
          <XStack ai="center" gap="$2">
            <UIAvatar size={24} label="Hello world" />
            <SizableText fontWeight="bold">Hello world</SizableText>
          </XStack>
          <XStack f={1} />
          <Button
            $gtSm={{display: 'none'}}
            icon={<Menu size={20} />}
            chromeless
            size="$2"
            onPress={() => {
              console.log(`== ~ Topbar ~ onPress: open:`, open)
              setOpen(true)
            }}
          />
          <Button
            display="none"
            $gtSm={{display: 'flex'}}
            icon={<Search size={20} />}
            chromeless
            size="$2"
          />
        </XStack>
        <XStack
          ai="center"
          gap="$2"
          padding="$2"
          jc="center"
          display="none"
          $gtSm={{display: 'flex'}}
        >
          <SizableText>Foo</SizableText>
          <SizableText>Bar</SizableText>
          <SizableText>Baz</SizableText>
          <SizableText>Lol</SizableText>
        </XStack>
      </YStack>
      <MobileMenu open={open} onClose={() => setOpen(false)}>
        {children}
      </MobileMenu>
    </>
  )
}

function MobileMenu({
  children,
  open,
  onClose,
}: {
  children: React.ReactNode
  open: boolean
  onClose: () => void
}) {
  return (
    <YStack
      $gtSm={{
        display: 'none',
      }}
      bg="$background"
      fullscreen
      // @ts-ignore
      position="fixed"
      top={0}
      right={0}
      bottom={0}
      zIndex="$zIndex.7"
      x={open ? 0 : '100%'}
      animation="fast"
    >
      <XStack p="$4">
        <XStack f={1}>
          <SizableText>search here</SizableText>
        </XStack>
        <Button
          icon={<Close size={20} />}
          chromeless
          size="$2"
          onPress={onClose}
        />
      </XStack>
      <ScrollView p="$4">{children}</ScrollView>
    </YStack>
  )
}
