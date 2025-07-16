import {
  getRoleName,
  HMCapability,
  useAddCapabilities,
  useAllDocumentCapabilities,
  useSelectedAccountCapability,
} from '@/models/access-control'
import {useSelectedAccountContacts} from '@/models/contacts'
import {useSubscribedResource} from '@/models/entities'
import {useNavigate} from '@/utils/useNavigate'
import * as Ariakit from '@ariakit/react'
import {CompositeInput} from '@ariakit/react-core/composite/composite-input'
import {Role} from '@shm/shared/client/grpc-types'
import {getContactMetadata} from '@shm/shared/content'
import {HMMetadata, UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useResource} from '@shm/shared/models/entity'
import {useSearch} from '@shm/shared/models/search'
import {createHMUrl, hmId, unpackHmId} from '@shm/shared/utils/entity-id-url'
import {UIAvatar} from '@shm/ui/avatar'
import {HMIcon, LoadedHMIcon} from '@shm/ui/hm-icon'
import {ArrowRight, X} from '@shm/ui/icons'
import {RadioButtons} from '@shm/ui/radio-buttons'
import {toast} from '@shm/ui/toast'
import {forwardRef, useEffect, useId, useMemo, useRef, useState} from 'react'
import {Button, ListItem, SizableText, XGroup, XStack, YGroup} from 'tamagui'
import {AccessoryContent} from './accessory-sidebar'
import './combobox.css'

export function CollaboratorsPanel({docId}: {docId: UnpackedHypermediaId}) {
  return (
    <AccessoryContent>
      <AddCollaboratorForm id={docId} />
      <PublisherCollaborator id={docId} />
      <CollaboratorsList id={docId} />
    </AccessoryContent>
  )
}

function PublisherCollaborator({id}: {id?: UnpackedHypermediaId}) {
  const navigate = useNavigate('push')
  const pubId = id ? hmId(id.uid) : null
  const resource = useResource(pubId)

  if (!id || !resource.data) return null
  const metadata =
    resource.data.type === 'document'
      ? resource.data.document?.metadata
      : undefined
  return (
    <div className="flex flex-col">
      <ListItem
        bg="$colorTransparent"
        hoverTheme
        pressTheme
        focusTheme
        outlineColor="transparent"
        hoverStyle={{backgroundColor: '$hoverColor'}}
        borderRadius="$2"
        paddingHorizontal="$3"
        paddingVertical={0}
        icon={<HMIcon metadata={metadata} id={id} size={24} />}
        onPress={() => {
          navigate({key: 'document', id: hmId(id.uid)})
        }}
      >
        <div className="flex flex-1 items-center gap-2">
          <SizableText size="$2" f={1}>
            {metadata?.name}
          </SizableText>
          <SizableText size="$1" color="$color9">
            Publisher
          </SizableText>
        </div>
      </ListItem>
    </div>
  )
}

type SearchResult = {
  id: UnpackedHypermediaId
  label: string
  unresolved?: boolean
  metadata?: HMMetadata
}

function AddCollaboratorForm({id}: {id: UnpackedHypermediaId}) {
  const myCapability = useSelectedAccountCapability(id, 'owner')
  const addCapabilities = useAddCapabilities(id)
  const [selectedCollaborators, setSelectedCollaborators] = useState<
    SearchResult[]
  >([])
  const capabilities = useAllDocumentCapabilities(id)

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
          if (!result.id.latest) return false // this is not the latest version
          if (result.id.path?.length) return false // this is a directory document, not an account
          if (result.id.uid === id.uid) return false // this account is already the owner, cannot be added
          if (
            capabilities.data?.find(
              (capability) => capability.grantId.uid === result.id.uid,
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
    <div className="flex flex-col gap-2">
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
                  let result = hmUrl ? createHMUrl(hmId(hmUrl.uid)) : null
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
    </div>
  )
}

const COLLABORATOR_TABS = [
  {key: 'granted', label: 'Granted'},
  // {key: 'devices', label: 'Devices'},
] as const

function CollaboratorsList({id}: {id: UnpackedHypermediaId}) {
  const capabilities = useAllDocumentCapabilities(id)
  const [tab, setTab] = useState<'granted' | 'devices'>('granted')
  let content = (
    <GrantedCollabs
      capabilities={
        capabilities.data?.filter(
          (cap) =>
            cap.grantId.id === id.id &&
            cap.role !== 'owner' &&
            cap.role !== 'agent',
        ) || []
      }
      id={id}
    />
  )
  if (tab === 'devices') {
    content = (
      <GrantedCollabs
        capabilities={
          capabilities.data?.filter(
            (cap) => cap.grantId.id === id.id && cap.role === 'agent',
          ) || []
        }
        id={id}
      />
    )
  }

  const parentCapabilities =
    capabilities.data?.filter(
      (cap) => cap.grantId.id !== id.id && cap.role !== 'agent',
    ) || []

  return (
    <div className="flex flex-col gap-3">
      {parentCapabilities ? (
        <div className="mb-3">
          {parentCapabilities.map((cap) => (
            <CollaboratorItem key={cap.accountUid} capability={cap} id={id} />
          ))}
        </div>
      ) : null}
      <div className="flex">
        <RadioButtons
          activeColor="$brand5"
          size="$2"
          options={COLLABORATOR_TABS}
          value={tab}
          onValue={setTab}
        />
      </div>
      {content}
    </div>
  )
}

function GrantedCollabs({
  capabilities = [],
  id,
}: {
  capabilities: Array<HMCapability>
  id: UnpackedHypermediaId
}) {
  return (
    <div>
      {capabilities?.map((capability) => {
        return (
          <CollaboratorItem
            key={capability.accountUid}
            capability={capability}
            id={id}
          />
        )
      })}
    </div>
  )
}

function CollaboratorItem({
  capability,
  id,
}: {
  capability: HMCapability
  id: UnpackedHypermediaId
}) {
  const navigate = useNavigate('push')
  const myContacts = useSelectedAccountContacts()
  const collaboratorId = hmId(capability.accountUid)
  const collaborator = useSubscribedResource(collaboratorId)
  const collaboratorMetadata =
    collaborator.data?.type === 'document'
      ? collaborator.data.document?.metadata
      : undefined
  if (capability.role === 'owner') return null
  return (
    <ListItem
      bg="$colorTransparent"
      hoverTheme
      pressTheme
      focusTheme
      outlineColor="transparent"
      hoverStyle={{backgroundColor: '$hoverColor'}}
      borderRadius="$2"
      paddingHorizontal="$3"
      paddingVertical={0}
      icon={
        <HMIcon metadata={collaboratorMetadata} id={collaboratorId} size={24} />
      }
      onPress={() => navigate({key: 'document', id: collaboratorId})}
    >
      <div className="flex flex-1 items-center gap-2">
        <SizableText size="$2" f={1}>
          {
            getContactMetadata(
              capability.accountUid,
              collaboratorMetadata,
              myContacts.data,
            )?.name
          }
        </SizableText>
        <SizableText size="$1" color="$color9">
          {getRoleName(capability.role)}{' '}
          {capability.grantId.id !== id.id ? '(Parent Capability)' : ''}
        </SizableText>
      </div>
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

    const select = Ariakit.useSelectStore<SearchResult>({
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
      select.setValue((prevSelectedValues: SearchResult[]) => {
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
      select.setValue((values: SearchResult[]) => {
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
            flex={1}
            borderRadius="$2"
            padding="$1"
            backgroundColor="$backgroundStrong"
          />
        }
      >
        <Ariakit.CompositeRow
          role="row"
          render={<div className="flex w-full flex-wrap gap-1" />}
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
                    <LoadedHMIcon id={value.id} size={20} />
                    <SizableText size="$3">{value.label}</SizableText>
                    {/* <span className="tag-remove"></span> */}
                  </>
                )}
                <X size={12} />
              </Ariakit.CompositeItem>
            )
          })}
          <div role="cell" className="flex flex-1 flex-col">
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
          </div>
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
  const resource = useResource(value.id)
  const metadata =
    resource.data?.type === 'document'
      ? resource.data.document?.metadata
      : undefined
  let label = metadata?.name || '...'
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
    const resource = useResource(props.member?.id)
    const metadata =
      resource.data?.type === 'document'
        ? resource.data.document?.metadata
        : undefined
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
        <div className="flex flex-1 justify-start gap-2">
          {/* <Ariakit.SelectItemCheck /> */}
          {metadata && props.member?.id ? (
            <HMIcon size={16} metadata={metadata} id={props.member?.id} />
          ) : null}
          <div className="flex flex-1">
            <SizableText size="$2" textColor="currentColor">
              {props.children || props.member?.label}
            </SizableText>
          </div>
        </div>
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
