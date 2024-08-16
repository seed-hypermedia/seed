import {
  getRoleName,
  useAddCapabilities,
  useAllDocumentCapabilities,
  useMyCapability,
} from '@/models/access-control'
import {useEntity} from '@/models/entities'
import {useSearch} from '@/models/search'
import {DocumentRoute} from '@/utils/routes'
import * as Ariakit from '@ariakit/react'
import {CompositeInput} from '@ariakit/react-core/composite/composite-input'
import {PlainMessage} from '@bufbuild/protobuf'
import {
  Capability,
  getDocumentTitle,
  hmId,
  Role,
  UnpackedHypermediaId,
  unpackHmId,
} from '@shm/shared'
import {
  Button,
  ListItem,
  Separator,
  SizableText,
  UIAvatar,
  XGroup,
  XStack,
  YGroup,
  YStack,
} from '@shm/ui'
import {ArrowRight, X} from '@tamagui/lucide-icons'
import {forwardRef, useEffect, useId, useMemo, useRef, useState} from 'react'
import {AccessoryContainer} from './accessory-sidebar'
import './combobox.css'
import {Thumbnail} from './thumbnail'

export function CollaboratorsPanel({
  route,
  onClose,
}: {
  route: DocumentRoute
  onClose: () => void
}) {
  return (
    <AccessoryContainer title="Collaborators" onClose={onClose}>
      <AddCollaboratorForm id={route.id} />
      <CollaboratorsList id={route.id} />
    </AccessoryContainer>
  )
}

type SearchResult = {
  id: UnpackedHypermediaId
  label: string
}

function AddCollaboratorForm({id}: {id: UnpackedHypermediaId}) {
  const myCapability = useMyCapability(id, 'admin')
  const addCapabilities = useAddCapabilities(id)
  const [selectedCollaborators, setSelectedCollaborators] = useState<
    SearchResult[]
  >([])
  const capabilities = useAllDocumentCapabilities(id)
  const [search, setSearch] = useState('')
  const searchResults = useSearch(search, {})

  const matches = useMemo(
    () =>
      (search ? searchResults.data : [])
        ?.map((result) => {
          const id = unpackHmId(result.id)
          if (!id) return null
          return {id, label: result.title}
        })
        .filter((result) => {
          if (!result) return false // probably id was not parsed correctly
          if (result.id.path?.length) return false // this is a directory document, not an account
          if (result.id.uid === id.uid) return false // this account is already the owner, cannot be added
          if (
            capabilities.data?.find(
              (capability) => capability.delegate === result.id.uid,
            )
          )
            return false // already added
          if (
            selectedCollaborators.find(
              (collab) => collab.id.id === result.id.id,
            )
          )
            return false // already added
          return true
        }) || [],
    [search, searchResults, selectedCollaborators],
  )

  if (!myCapability) return null
  return (
    <YStack gap="$2">
      <XGroup
        borderWidth={1}
        borderColor="$color8"
        animation="fast"
        bg="$backgroundStrong"
        borderRadius="$2"
        overflow="hidden"
      >
        <XGroup.Item>
          <TagInput
            label="Members"
            value={search}
            onChange={setSearch}
            values={selectedCollaborators}
            onValuesChange={(collabs) => {
              setSelectedCollaborators(collabs)
            }}
            placeholder="Invite members"
          >
            {matches.map(
              (result) =>
                result && (
                  <TagInputItem
                    onClick={() => {
                      setSelectedCollaborators((vals) => [...vals, result])
                    }}
                    member={result}
                  >
                    Add &quot;{result?.label}&quot;
                  </TagInputItem>
                ),
            )}
            {search && matches.length == 0 ? (
              <TagInputItem
                onClick={() => {
                  console.log('Add new member', search)
                  setSelectedCollaborators((v) => v)
                  setSearch('')
                }}
              >
                Add &quot;{search}&quot;
              </TagInputItem>
            ) : null}
          </TagInput>
        </XGroup.Item>

        {selectedCollaborators.length ? (
          <XGroup.Item>
            <Button
              size="$2"
              onPress={() => {
                setSearch('')
                addCapabilities.mutate({
                  myCapability: myCapability,
                  collaboratorAccountIds: selectedCollaborators.map(
                    (collab) => collab.id.uid,
                  ),
                  role: Role.WRITER,
                })
              }}
              bg="#DED9FF"
              hoverStyle={{
                bg: '#FFDED9',
              }}
              iconAfter={ArrowRight}
            />
          </XGroup.Item>
        ) : null}
      </XGroup>

      {/* <Button bg="#DED9FF" icon={Link} size="$2">
        Generate Invite Link
      </Button> */}
    </YStack>
  )
}

function CollaboratorsList({id}: {id: UnpackedHypermediaId}) {
  const capabilities = useAllDocumentCapabilities(id)
  return (
    <YStack marginHorizontal={-8}>
      {capabilities.data?.map((capability) => {
        return (
          <CollaboratorItem key={capability.account} capability={capability} />
        )
      })}
    </YStack>
  )
}

function CollaboratorItem({
  capability,
}: {
  capability: PlainMessage<Capability>
}) {
  const collaboratorId = hmId('d', capability.delegate)
  const entity = useEntity(collaboratorId)
  return (
    <XStack ai="center" gap="$2" padding="$2">
      <Thumbnail
        metadata={entity.data?.document?.metadata}
        id={collaboratorId}
        size={24}
      />
      <SizableText size="$2" f={1}>
        {getDocumentTitle(entity.data?.document)}
      </SizableText>
      <SizableText size="$1" color="$color9">
        {getRoleName(capability.role)}
      </SizableText>
    </XStack>
  )
}

export interface TagInputProps extends Omit<Ariakit.ComboboxProps, 'onChange'> {
  label: string
  value?: string
  onChange?: (value: string) => void
  defaultValue?: string
  values?: Array<SearchResult>
  onValuesChange?: (values: Array<SearchResult>) => void
  defaultValues?: Array<SearchResult>
}

export const TagInput = forwardRef<HTMLInputElement, TagInputProps>(
  function TagInput(props, ref) {
    const {
      label,
      defaultValue,
      value,
      onChange,
      defaultValues,
      values,
      onValuesChange,
      children,
      ...comboboxProps
    } = props

    const comboboxRef = useRef<HTMLInputElement>(null)
    const defaultComboboxId = useId()
    const comboboxId = comboboxProps.id || defaultComboboxId

    const combobox = Ariakit.useComboboxStore({
      value,
      defaultValue,
      setValue: onChange,
      resetValueOnHide: true,
    })

    const select = Ariakit.useSelectStore<any>({
      combobox,
      value: values,
      defaultValue: defaultValues,
      setValue: onValuesChange,
    })

    const composite = Ariakit.useCompositeStore({
      defaultActiveId: comboboxId,
    })

    const selectedValues = select.useState('value')

    // Reset the combobox value whenever an item is checked or unchecked.
    useEffect(() => combobox.setValue(''), [selectedValues, combobox])

    const toggleValueFromSelectedValues = (value: SearchResult) => {
      select.setValue((prevSelectedValues) => {
        const index = prevSelectedValues.indexOf(value)
        if (index !== -1) {
          return prevSelectedValues.filter(
            (v: SearchResult) => v.id.id != value.id.id,
          )
        }
        return [...prevSelectedValues, value]
      })
    }

    const onItemClick = (value: SearchResult) => () => {
      toggleValueFromSelectedValues(value)
    }

    const onItemKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.currentTarget.click()
      }
    }

    const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== 'Backspace') return
      const {selectionStart, selectionEnd} = event.currentTarget
      const isCaretAtTheBeginning = selectionStart === 0 && selectionEnd === 0
      if (!isCaretAtTheBeginning) return
      select.setValue((values) => {
        if (!values.length) return values
        return values.slice(0, values.length - 1)
      })
      combobox.hide()
    }

    return (
      <Ariakit.Composite
        store={composite}
        role="grid"
        aria-label={label}
        className="tag-grid"
        onClick={() => comboboxRef.current?.focus()}
        render={
          <XStack
            // borderColor="$borderColor"
            // borderWidth={1}
            bg="red"
            flex={1}
            borderRadius="$2"
            padding="$1"
            backgroundColor="$backgroundStrong"
          />
        }
      >
        <Ariakit.CompositeRow
          role="row"
          render={<XStack gap="$1" width="100%" flexWrap="wrap" />}
        >
          {selectedValues.map((value: SearchResult) => {
            return (
              // <AccountCard accountId={value} key={value}>
              <Ariakit.CompositeItem
                key={value.id.id}
                role="gridcell"
                onClick={onItemClick(value)}
                onKeyDown={onItemKeyDown}
                onFocus={combobox.hide}
                render={
                  <XStack
                    gap="$2"
                    padding="$1.5"
                    minHeight="2rem"
                    borderRadius="$1"
                    backgroundColor="$backgroundFocus"
                    borderColor="$borderColor"
                    alignItems="center"
                    hoverStyle={{
                      cursor: 'pointer',
                      backgroundColor: '$color7',
                    }}
                  />
                }
              >
                <UIAvatar label={value.label} id={value.id.id} />
                <SizableText size="$3">{value.label}</SizableText>
                {/* <span className="tag-remove"></span> */}
                <X size={12} />
              </Ariakit.CompositeItem>
              // </AccountCard>
            )
          })}
          <YStack role="gridcell" flex={1}>
            <Ariakit.CompositeItem
              id={comboboxId}
              render={
                <CompositeInput
                  ref={comboboxRef}
                  onKeyDown={onInputKeyDown}
                  render={
                    <Ariakit.Combobox
                      ref={ref}
                      store={combobox}
                      autoSelect
                      className="combobox"
                      {...comboboxProps}
                    />
                  }
                />
              }
            />
          </YStack>
          <Ariakit.ComboboxPopover
            store={combobox}
            portal
            sameWidth
            gutter={8}
            render={
              <Ariakit.SelectList
                store={select}
                render={
                  <YGroup
                    zIndex={100000}
                    backgroundColor="$background"
                    separator={<Separator />}
                  />
                }
              />
            }
          >
            {children}
          </Ariakit.ComboboxPopover>
        </Ariakit.CompositeRow>
      </Ariakit.Composite>
    )
  },
)

export interface TagInputItemProps extends Ariakit.SelectItemProps {
  children?: React.ReactNode
  member?: SearchResult
}

export const TagInputItem = forwardRef<HTMLDivElement, TagInputItemProps>(
  function TagInputItem(props, ref) {
    const entity = useEntity(props.member?.id)
    return (
      <Ariakit.SelectItem
        ref={ref}
        {...props}
        render={
          <Ariakit.ComboboxItem
            render={
              <TagInputItemContent
                className="combobox-item"
                render={props.render}
              />
            }
          />
        }
      >
        <XStack gap="$2" flex={1} jc="flex-start">
          <Ariakit.SelectItemCheck />
          {entity.data?.document?.metadata ? (
            <Thumbnail
              size={20}
              metadata={entity.data?.document?.metadata}
              id={props.member?.id}
            />
          ) : null}
          <XStack flex={1}>
            <SizableText size="$3" color="currentColor">
              {props.children || props.member?.label}
            </SizableText>
          </XStack>
        </XStack>
      </Ariakit.SelectItem>
    )
  },
)

const TagInputItemContent = forwardRef<any, any>(
  function TagInputItemContent(props, ref) {
    let {render, children, ...restProps} = props

    return (
      <YGroup.Item>
        <ListItem ref={ref} {...restProps} className="combobox-item">
          {render ? render : children}
        </ListItem>
      </YGroup.Item>
    )
  },
)
