import * as Ariakit from '@ariakit/react'
import {CompositeInput} from '@ariakit/react-core/composite/composite-input'
import {HMMetadata, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useAccount, useResource} from '@shm/shared/models/entity'
import {abbreviateUid} from '@shm/shared/utils/abbreviate'
import {forwardRef, useEffect, useId, useRef} from 'react'
import './combobox.css'
import {HMIcon, LoadedHMIcon} from './hm-icon'
import {X} from './icons'
import {SizableText} from './text'

export type AccountSearchResult = {
  id: UnpackedHypermediaId
  label: string
  unresolved?: boolean
  metadata?: HMMetadata
}

interface AccountTagInputProps extends Omit<Ariakit.ComboboxProps, 'onChange'> {
  label: string
  value?: string
  onChange?: (value: string) => void
  defaultValue?: string
  values?: Array<AccountSearchResult>
  onValuesChange?: (values: Array<AccountSearchResult>) => void
  defaultValues?: Array<AccountSearchResult>
}

export const AccountTagInput = forwardRef<HTMLInputElement, AccountTagInputProps>(function AccountTagInput(props, ref) {
  const {
    label,
    defaultValue,
    value,
    onChange,
    defaultValues,
    values,
    onValuesChange,
    children,
    className,
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

  // @ts-expect-error Ariakit's generic Select store value works here but TS cannot infer the array type.
  const select = Ariakit.useSelectStore<AccountSearchResult>({
    combobox,
    value: values,
    defaultValue: defaultValues,
    setValue: onValuesChange,
  })

  const composite = Ariakit.useCompositeStore({
    defaultActiveId: comboboxId,
  })

  const selectedValues = select.useState('value')

  useEffect(() => combobox.setValue(''), [selectedValues, combobox])

  const toggleValueFromSelectedValues = (value: AccountSearchResult) => {
    // @ts-expect-error Ariakit supports updater callbacks for controlled values.
    select.setValue((prevSelectedValues: Array<AccountSearchResult>) => {
      const index = prevSelectedValues.indexOf(value)
      if (index !== -1) {
        return prevSelectedValues.filter((v) => v.id.id != value.id.id)
      }
      return [...prevSelectedValues, value]
    })
  }

  const onItemClick = (value: AccountSearchResult) => () => {
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
    // @ts-expect-error Ariakit supports updater callbacks for controlled values.
    select.setValue((values: Array<AccountSearchResult>) => {
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
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        comboboxRef.current?.focus()
      }}
      render={<div className="flex flex-1 rounded-md p-1" />}
    >
      <Ariakit.CompositeRow role="row" render={<div className="flex w-full flex-wrap gap-1" />}>
        {/* @ts-expect-error Ariakit selected value state is the AccountSearchResult array configured above. */}
        {selectedValues.map((selectedValue: AccountSearchResult) => {
          return (
            <Ariakit.CompositeItem
              key={selectedValue.id.id}
              role="gridcell"
              onClick={onItemClick(selectedValue)}
              onKeyDown={onItemKeyDown}
              onFocus={combobox.hide}
              render={
                <div className="bg-background border-border flex min-h-6 items-center gap-1 rounded-md border p-1 px-2 hover:bg-black/10 dark:hover:bg-white/10" />
              }
            >
              <SelectedAccountItem value={selectedValue} />
              <X size={12} />
            </Ariakit.CompositeItem>
          )
        })}
        <div role="cell" className="flex min-w-0 flex-1 flex-col">
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
                    size={1}
                    className={`combobox w-full min-w-0 ${className ?? ''}`}
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
              // @ts-expect-error Ariakit store value is configured as AccountSearchResult[].
              store={select}
              render={<div className="z-100 rounded-sm bg-white dark:bg-black" />}
            />
          }
        >
          {children}
        </Ariakit.ComboboxPopover>
      </Ariakit.CompositeRow>
    </Ariakit.Composite>
  )
})

function SelectedAccountItem({value}: {value: AccountSearchResult}) {
  if (value.metadata) {
    return (
      <>
        <HMIcon id={value.id} name={value.metadata.name} icon={value.metadata.icon} size={20} />
        <SizableText>{value.metadata.name || value.label}</SizableText>
      </>
    )
  }

  if (value.unresolved) return <UnresolvedAccountItem value={value} />

  return (
    <>
      <LoadedHMIcon id={value.id} size={20} />
      <SizableText>{value.label}</SizableText>
    </>
  )
}

function UnresolvedAccountItem({value}: {value: AccountSearchResult}) {
  const account = useAccount(value.id.uid, {subscribe: true})
  const metadata = account.data?.metadata
  const label = metadata?.name || abbreviateUid(value.id.uid)
  return (
    <>
      <HMIcon id={value.id} name={metadata?.name} icon={metadata?.icon} size={20} />
      <SizableText>{label}</SizableText>
    </>
  )
}

interface AccountTagInputItemProps extends Ariakit.SelectItemProps {
  children?: React.ReactNode
  account?: AccountSearchResult
}

export const AccountTagInputItem = forwardRef<HTMLDivElement, AccountTagInputItemProps>(
  function AccountTagInputItem(props, ref) {
    const {onMouseDown, onClick, ...itemProps} = props
    const resource = useResource(props.account?.id)
    const metadata =
      props.account?.metadata ?? (resource.data?.type === 'document' ? resource.data.document?.metadata : undefined)
    return (
      <Ariakit.SelectItem
        ref={ref}
        {...itemProps}
        onMouseDown={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onMouseDown?.(event)
        }}
        onClick={(event) => {
          event.stopPropagation()
          onClick?.(event)
        }}
        render={
          <Ariakit.ComboboxItem
            render={<AccountTagInputItemContent className="combobox-item" render={props.render} />}
          />
        }
      >
        <div className="flex flex-1 justify-start gap-2">
          {metadata && props.account?.id ? (
            <HMIcon size={16} name={metadata.name} icon={metadata.icon} id={props.account.id} />
          ) : null}
          <div className="flex flex-1">
            <SizableText size="sm" className="text-currentColor">
              {props.children || props.account?.label}
            </SizableText>
          </div>
        </div>
      </Ariakit.SelectItem>
    )
  },
)

const AccountTagInputItemContent = forwardRef<any, any>(function AccountTagInputItemContent(props, ref) {
  let {render, children, ...restProps} = props

  return (
    <div ref={ref} {...restProps} className="combobox-item data-[active-item]:bg-accent flex flex-1 gap-2 p-3">
      {render ? render : children}
    </div>
  )
})
