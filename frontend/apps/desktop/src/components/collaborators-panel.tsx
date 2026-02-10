import {
  useAddCapabilities,
  useAllDocumentCapabilities,
  useSelectedAccountCapability,
} from '@/models/access-control'
import {useSelectedAccountId} from '@/selected-account'
import * as Ariakit from '@ariakit/react'
import {CompositeInput} from '@ariakit/react-core/composite/composite-input'
import {Role} from '@shm/shared/client/grpc-types'
import {HMMetadata, UnpackedHypermediaId} from '@shm/shared/hm-types'
import {useResource} from '@shm/shared/models/entity'
import {useSearch} from '@shm/shared/models/search'
import {abbreviateUid} from '@shm/shared/utils/abbreviate'
import {hmId, hmIdToURL, unpackHmId} from '@shm/shared/utils/entity-id-url'
import {PanelContent} from '@shm/ui/accessories'
import {UIAvatar} from '@shm/ui/avatar'
import {Button} from '@shm/ui/button'
import {ReadOnlyCollaboratorsContent} from '@shm/ui/collaborators-page'
import {HMIcon, LoadedHMIcon} from '@shm/ui/hm-icon'
import {ArrowRight, X} from '@shm/ui/icons'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {forwardRef, useEffect, useId, useMemo, useRef, useState} from 'react'
import './combobox.css'

export function CollaboratorsPanel({docId}: {docId: UnpackedHypermediaId}) {
  return (
    <PanelContent>
      <AddCollaboratorForm id={docId} />
      <ReadOnlyCollaboratorsContent docId={docId} />
    </PanelContent>
  )
}

type SearchResult = {
  id: UnpackedHypermediaId
  label: string
  unresolved?: boolean
  metadata?: HMMetadata
}

export function AddCollaboratorForm({id}: {id: UnpackedHypermediaId}) {
  const myCapability = useSelectedAccountCapability(id, 'owner')
  const addCapabilities = useAddCapabilities(id)
  const [selectedCollaborators, setSelectedCollaborators] = useState<
    SearchResult[]
  >([])
  const capabilities = useAllDocumentCapabilities(id)

  const [search, setSearch] = useState('')
  const selectedAccountId = useSelectedAccountId()
  const searchResults = useSearch(search, {
    perspectiveAccountUid: selectedAccountId ?? undefined,
  })

  const matches = useMemo(
    () =>
      (search ? searchResults.data?.entities : [])
        ?.map((result) => {
          return {
            id: result.id,
            label: result.title,
            type: result.type,
            metadata: result.metadata,
          }
        })
        .filter((result) => {
          if (!result) return false // probably id was not parsed correctly
          if (result.type == 'contact') return true
          if (result.id.path?.length) return false // this is a directory document, not an account
          if (result.id.uid === id.uid) return false // this account is already the owner, cannot be added
          if (result.type == 'document') return true // this is a directory document, not an account
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

          // this is temporarily disabled because the API is not returning the `&l` flag correctly
          // if (!result.id.latest) return false // this is not the latest version

          return true
        }) || [],
    [search, searchResults, selectedCollaborators, capabilities.data],
  )

  if (!myCapability) return null
  return (
    <div className="flex flex-col gap-2 px-4 pt-4">
      <div className="border-border flex overflow-hidden rounded-md border-1">
        <div className="flex flex-1">
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
                  let result = hmUrl ? hmIdToURL(hmId(hmUrl.uid)) : null
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
        </div>
        {selectedCollaborators.length ? (
          <Button
            size="sm"
            className="h-auto rounded-tl-none rounded-bl-none"
            onClick={() => {
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
            variant="default"
          >
            <ArrowRight className="size-4" />
          </Button>
        ) : null}
      </div>
    </div>
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

    // @ts-expect-error
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
      // @ts-expect-error
      select.setValue((prevSelectedValues: Array<SearchResult>) => {
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
      // @ts-expect-error
      select.setValue((values: Array<SearchResult>) => {
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
        render={<div className="flex flex-1 rounded-md p-1" />}
      >
        <Ariakit.CompositeRow
          role="row"
          render={<div className="flex w-full flex-wrap gap-1" />}
        >
          {/* @ts-expect-error */}
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
                  <div className="bg-background border-border flex min-h-6 items-center gap-1 rounded-md border p-1 px-2 hover:bg-black/10 dark:hover:bg-white/10" />
                }
              >
                {'unresolved' in value && value.unresolved ? (
                  <UnresolvedItem value={value} />
                ) : (
                  <>
                    <LoadedHMIcon id={value.id} size={20} />
                    <SizableText>{value.label}</SizableText>
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
                // @ts-expect-error
                store={select}
                render={
                  <div className="z-100 rounded-sm bg-white dark:bg-black" />
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
  let label = metadata?.name || abbreviateUid(value.id.uid)
  return (
    <>
      <UIAvatar label={label} id={value.id.uid} />
      <SizableText>{label}</SizableText>
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
            <HMIcon
              size={16}
              name={metadata?.name}
              icon={metadata?.icon}
              id={props.member?.id}
            />
          ) : null}
          <div className="flex flex-1">
            <SizableText size="sm" className="text-currentColor">
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
      <div
        ref={ref}
        {...restProps}
        className="combobox-item data-[active-item]:bg-accent flex flex-1 gap-2 p-3"
      >
        {render ? render : children}
      </div>
    )
  },
)
