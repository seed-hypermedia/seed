// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const modelState = vi.hoisted(() => ({
  providerType: 'custom',
  models: [] as Array<{id: string; name: string}>,
  isError: false,
}))

vi.mock('../agents/models', () => ({
  useModelProviders: () => ({
    data: [{id: 'custom-provider', name: 'Local API', type: modelState.providerType}],
    isLoading: false,
  }),
  useProviderModels: () => ({
    data: modelState.models,
    isError: modelState.isError,
    isLoading: false,
    isFetching: false,
    error: modelState.isError ? new Error('Discovery failed') : null,
    refetch: vi.fn(),
  }),
}))

vi.mock('../components/popover', () => ({
  Popover: ({children}: {children: React.ReactNode}) => <>{children}</>,
  PopoverTrigger: ({children, ...props}: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  PopoverContent: ({children}: {children: React.ReactNode}) => <div>{children}</div>,
}))

vi.mock('../components/input', () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}))
vi.mock('../notice', () => ({Notice: ({children}: {children: React.ReactNode}) => <div>{children}</div>}))
vi.mock('../text', () => ({SizableText: ({children}: {children: React.ReactNode}) => <span>{children}</span>}))
vi.mock('../agents/provider-icons', () => ({ProviderIcon: () => null}))

import {ProviderModelSelect} from '../agents/provider-model-select'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  modelState.providerType = 'custom'
  modelState.models = []
  modelState.isError = false
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function typeModel(model: string) {
  const input = container.querySelector('input')!
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    setter.call(input, model)
    input.dispatchEvent(new Event('input', {bubbles: true}))
  })
}

describe('ProviderModelSelect custom model fallback', () => {
  it.each([
    ['an empty catalog', [], false],
    ['failed discovery', [], true],
    ['discovery returns no exact match', [{id: 'org/casesensitive-model', name: 'Different case'}], false],
  ])('retains an exact-case custom model ID when %s', (_label, models, isError) => {
    modelState.models = models
    modelState.isError = isError
    const onChange = vi.fn()
    act(() => {
      root.render(
        <ProviderModelSelect
          serverUrl="http://localhost:9999"
          accountUid="account"
          value={{provider: '', model: ''}}
          onChange={onChange}
        />,
      )
    })

    typeModel('Org/CaseSensitive-Model')
    const option = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('Use “Org/CaseSensitive-Model”'),
    )
    expect(option).toBeDefined()

    act(() => option!.click())
    expect(onChange).toHaveBeenCalledWith({provider: 'Local API', model: 'Org/CaseSensitive-Model'})
  })

  it('does not duplicate an exact discovered custom model', () => {
    modelState.models = [{id: 'Org/Exact-Model', name: 'Org/Exact-Model'}]
    act(() => {
      root.render(
        <ProviderModelSelect
          serverUrl="http://localhost:9999"
          accountUid="account"
          value={{provider: '', model: ''}}
          onChange={vi.fn()}
        />,
      )
    })

    typeModel('Org/Exact-Model')
    expect(container.textContent).not.toContain('Use “Org/Exact-Model”')
  })

  it('does not offer arbitrary model IDs for catalog-only providers', () => {
    modelState.providerType = 'openai'
    act(() => {
      root.render(
        <ProviderModelSelect
          serverUrl="http://localhost:9999"
          accountUid="account"
          value={{provider: '', model: ''}}
          onChange={vi.fn()}
        />,
      )
    })

    typeModel('not-in-catalog')
    expect(container.textContent).not.toContain('Use “not-in-catalog”')
  })
})
