import {Check, ChevronDown, ChevronUp, Select, XStack, YStack} from '@shm/ui'
import {NodeViewProps} from '@tiptap/core'
import {NodeViewContent} from '@tiptap/react'
import {useState} from 'react'

export const CodeBlockView = ({
  props,
  languages,
}: {
  props: NodeViewProps
  languages: string[]
}) => {
  const {node, updateAttributes} = props
  const [hovered, setHovered] = useState(false)
  const [language, setLanguage] = useState(
    node.attrs.language ? node.attrs.language : 'plaintext',
  )
  const handleChange = (newLanguage: string) => {
    updateAttributes({language: newLanguage})
    setLanguage(newLanguage)
  }

  return (
    <YStack
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
    >
      {hovered && (
        <XStack
          position="absolute"
          top={-8}
          right={-12}
          width={150}
          zIndex="$zIndex.5"
          ai="center"
          jc="flex-end"
          opacity={hovered ? 1 : 0}
          padding="$1"
          gap="$4"
          $group-item-hover={{opacity: 1}}
        >
          <Select value={language} onValueChange={handleChange}>
            <Select.Trigger iconAfter={ChevronDown} size="$2.5">
              <Select.Value placeholder="plaintext" />
            </Select.Trigger>

            <Select.Content zIndex={200000}>
              <Select.ScrollUpButton
                alignItems="center"
                justifyContent="center"
                position="relative"
                width="100%"
                height="$3"
              >
                <YStack zIndex={10}>
                  <ChevronUp size={20} />
                </YStack>
              </Select.ScrollUpButton>
              <Select.Viewport minWidth={200}>
                <Select.Group maxHeight={'60vh'}>
                  {languages.map((item, i) => {
                    return (
                      <Select.Item
                        index={i}
                        key={item}
                        value={item.toLowerCase()}
                      >
                        <Select.ItemText>{item}</Select.ItemText>
                        <Select.ItemIndicator marginLeft="auto">
                          <Check size={16} />
                        </Select.ItemIndicator>
                      </Select.Item>
                    )
                  })}
                </Select.Group>
              </Select.Viewport>
              <Select.ScrollDownButton
                alignItems="center"
                justifyContent="center"
                position="relative"
                width="100%"
                height="$3"
              >
                <YStack zIndex={10}>
                  <ChevronDown size={20} />
                </YStack>
              </Select.ScrollDownButton>
            </Select.Content>
          </Select>
        </XStack>
      )}
      <pre>
        <code className={`language-${language}`}>
          <NodeViewContent />
        </code>
      </pre>
    </YStack>
  )
}
