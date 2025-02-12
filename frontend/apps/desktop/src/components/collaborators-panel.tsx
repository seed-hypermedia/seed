import {
  getRoleName,
  useAddCapabilities,
  useAllDocumentCapabilities,
  useMyCapability,
} from '@/models/access-control'
import {useEntity, useSubscribedEntity} from '@/models/entities'
import {useNavigate} from '@/utils/useNavigate'
import * as Ariakit from '@ariakit/react'
import {CompositeInput} from '@ariakit/react-core/composite/composite-input'
import {PlainMessage} from '@bufbuild/protobuf'

import {Capability, Role} from '@shm/shared/client/grpc-types'
import {getDocumentTitle} from '@shm/shared/content'
import {useSearch} from '@shm/shared/models/search'
import {DocumentRoute} from '@shm/shared/routes'
import {
  createHMUrl,
  hmId,
  UnpackedHypermediaId,
  unpackHmId,
} from '@shm/shared/utils/entity-id-url'
import {
  ArrowRight,
  Button,
  HMIcon,
  ListItem,
  RadioButtons,
  SizableText,
  toast,
  UIAvatar,
  X,
  XGroup,
  XStack,
  YGroup,
  YStack,
} from '@shm/ui'
import {forwardRef, useEffect, useId, useMemo, useRef, useState} from 'react'
import {AccessoryContainer} from './accessory-sidebar'
import './combobox.css'

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
      <PublisherCollaborator id={route.id} />
      <CollaboratorsList id={route.id} />
    </AccessoryContainer>
  )
}

function PublisherCollaborator({id}: {id?: UnpackedHypermediaId}) {
  const navigate = useNavigate('push')
  const pubId = id ? hmId('d', id.uid) : null
  const entity = useEntity(pubId)

  if (!id || !entity.data) return null

  return (
    <YStack marginHorizontal={-8}>
      <ListItem
        bg="$colorTransparent"
        hoverTheme
        pressTheme
        focusTheme
        outlineColor="transparent"
        hoverStyle={{backgroundColor: '$color7'}}
        borderRadius="$2"
        paddingHorizontal="$3"
        paddingVertical={0}
        icon={
          <HMIcon
            metadata={entity.data?.document?.metadata}
            id={id?.uid}
            size={24}
          />
        }
        onPress={() => navigate({key: 'document', id})}
      >
        <XStack f={1} ai="center" gap="$2">
          <SizableText size="$2" f={1}>
            {getDocumentTitle(entity.data?.document)}
          </SizableText>
          <SizableText size="$1" color="$color9">
            Publisher
          </SizableText>
        </XStack>
      </ListItem>
    </YStack>
  )
}

type SearchResult = {
  id: UnpackedHypermediaId
  label: string
  unresolved?: boolean
}

function AddCollaboratorForm({id}: {id: UnpackedHypermediaId}) {
  const myCapability = useMyCapability(id)
  const addCapabilities = useAddCapabilities(id)
  const [selectedCollaborators, setSelectedCollaborators] = useState<
    SearchResult[]
  >([])
  const capabilities = useAllDocumentCapabilities(id)

  console.log(`== ~ AddCollaboratorForm ~ capabilities:`, capabilities)
  const [search, setSearch] = useState('')
  const searchResults = useSearch(search, {})

  const matches = useMemo(
    () =>
      (search ? searchResults.data?.entities : [])
        ?.map((result) => {
          return {id: result.id, label: result.title}
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
                    key={result.id.id}
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
                  let hmUrl = unpackHmId(search)
                  let result = hmUrl ? createHMUrl(hmId('d', hmUrl.uid)) : null
                  if (result && hmUrl) {
                    setSelectedCollaborators((v) => [
                      ...v,
                      {id: hmUrl, label: result, unresolved: true},
                    ])
                    setSearch('')
                  } else {
                    toast.error('Invalid Collaborator Input')
                  }
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
              h="auto"
              onPress={() => {
                addCapabilities.mutate({
                  myCapability: myCapability,
                  collaboratorAccountIds: selectedCollaborators.map(
                    (collab) => collab.id.uid,
                  ),
                  role: Role.WRITER,
                })
                setSearch('')
                setSelectedCollaborators([])
              }}
              bg="$brand5"
              borderColor="$brand5"
              color="white"
              hoverStyle={{
                bg: '$brand6',
                color: 'white',
                borderColor: '$brand6',
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
  const [tab, setTab] = useState<'granted' | 'pending'>('granted')
  let content = (
    <GrantedCollabs
      capabilities={
        capabilities.data?.filter((cap) => !cap.isGrantedToParent) || []
      }
    />
  )

  const parentCapabilities =
    capabilities.data?.filter((cap) => cap.isGrantedToParent) || []

  // if (tab == 'pending') {
  //   content = <PendingCollabs capabilities={capabilities.data || []} />
  // }

  return (
    <YStack gap="$3">
      {parentCapabilities ? (
        <YStack marginBottom="$3">
          {parentCapabilities.map((cap) => (
            <CollaboratorItem key={cap.account} capability={cap} />
          ))}
        </YStack>
      ) : null}
      <XStack>
        <RadioButtons
          activeColor="$brand5"
          size="$2"
          options={[
            {key: 'granted', label: 'Granted'},
            // {key: 'pending', label: 'Pending'},
          ]}
          value={tab}
          // onValue={setTab}
          onValue={() => {}}
        />
      </XStack>
      {content}
    </YStack>
  )
}

function GrantedCollabs({
  capabilities = [],
}: {
  capabilities: Array<PlainMessage<Capability>>
}) {
  return (
    <YStack marginHorizontal={-8}>
      {capabilities?.map((capability) => {
        return (
          <CollaboratorItem key={capability.account} capability={capability} />
        )
      })}
    </YStack>
  )
}

function PendingCollabs({
  capabilities = [],
}: {
  capabilities: Array<PlainMessage<Capability>>
}) {
  // return (
  //   <YStack marginHorizontal={-8}>
  //     {capabilities?.map((capability) => {
  //       return (
  //         <CollaboratorItem key={capability.account} capability={capability} />
  //       )
  //     })}
  //   </YStack>
  // )
  return null
}

function CollaboratorItem({
  capability,
}: {
  capability: PlainMessage<Capability> & {isGrantedToParent: boolean}
}) {
  const navigate = useNavigate('push')
  const collaboratorId = hmId('d', capability.delegate)
  const entity = useSubscribedEntity(collaboratorId)
  return (
    <ListItem
      bg="$colorTransparent"
      hoverTheme
      pressTheme
      focusTheme
      outlineColor="transparent"
      hoverStyle={{backgroundColor: '$color7'}}
      borderRadius="$2"
      paddingHorizontal="$3"
      paddingVertical={0}
      icon={
        <HMIcon
          metadata={entity.data?.document?.metadata}
          id={collaboratorId}
          size={24}
        />
      }
      onPress={() => navigate({key: 'document', id: collaboratorId})}
    >
      <XStack f={1} ai="center" gap="$2">
        <SizableText size="$2" f={1}>
          {getDocumentTitle(entity.data?.document)}
        </SizableText>
        <SizableText size="$1" color="$color9">
          {getRoleName(capability.role)}{' '}
          {capability.isGrantedToParent ? '(Parent Capability)' : ''}
        </SizableText>
      </XStack>
    </ListItem>
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
            // TODO: (horacio): Should I cleanup the list from the `unresolved` value?
            return (
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
                      backgroundColor: '$color7',
                    }}
                  />
                }
              >
                {'unresolved' in value && value.unresolved ? (
                  <UnresolvedItem value={value} />
                ) : (
                  <>
                    <UIAvatar label={value.label} id={value.id.id} />
                    <SizableText size="$3">{value.label}</SizableText>
                    {/* <span className="tag-remove"></span> */}
                  </>
                )}
                <X size={12} />
              </Ariakit.CompositeItem>
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
                  <YGroup zIndex="$zIndex.5" backgroundColor="$background" />
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

function UnresolvedItem({value}: {value: SearchResult}) {
  const entity = useEntity(value.id)
  let label = entity.data?.document?.metadata.name || '...'
  return (
    <>
      <UIAvatar label={label} id={value.id.id} />
      <SizableText size="$3">{label}</SizableText>
    </>
  )
}

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
          {/* <Ariakit.SelectItemCheck /> */}
          {entity.data?.document?.metadata ? (
            <HMIcon
              size={16}
              metadata={entity.data?.document?.metadata}
              id={props.member?.id}
            />
          ) : null}
          <XStack flex={1}>
            <SizableText size="$2" color="currentColor">
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
        <ListItem size="$3" ref={ref} {...restProps} className="combobox-item">
          {render ? render : children}
        </ListItem>
      </YGroup.Item>
    )
  },
)
