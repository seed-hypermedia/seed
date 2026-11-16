// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, describe, expect, it, vi} from 'vitest'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const remembered: string[] = []
vi.mock('../agents/models', () => ({
  useRememberAgentServer: () => ({
    mutateAsync: async (url: string) => {
      remembered.push(url)
      return url
    },
  }),
}))
vi.mock('../agents/client', () => ({
  findAppServer: async (text: string) => {
    if (text === 'nowhere.example') throw new Error('No app server answers at nowhere.example')
    return `https://${text}/hm/api/apps`
  },
}))
vi.mock('../apps/running', () => ({
  appServerErrorMessage: (error: unknown) => String(error),
  useAppServerCheck: (serverUrl: string) => ({
    isError: false,
    isInitialLoading: false,
    data: !serverUrl
      ? undefined
      : serverUrl.includes('closed')
        ? {allowed: false, reason: 'Only someone who can write to the app’s space can run or stop it', run: null}
        : {allowed: true, run: null},
  }),
}))

import {AppServerSelect} from '../apps/app-server-select'

let root: Root | null = null
let host: HTMLElement | null = null

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = host = null
  remembered.length = 0
})

function renderSelect(value: string, onChange = vi.fn()) {
  host = document.body.appendChild(document.createElement('div'))
  root = createRoot(host)
  act(() =>
    root!.render(
      <AppServerSelect
        appId="hm://space/app"
        value={value}
        onChange={onChange}
        localServerUrl="http://localhost:3051"
        options={[
          {url: 'https://hyper.media/hm/api/apps'},
          {url: 'http://localhost:3051'},
          {url: 'https://closed.example', onForget: vi.fn()},
        ]}
      />,
    ),
  )
  return onChange
}

const one = (selector: string) => document.body.querySelector<HTMLElement>(selector)!
const all = (selector: string) => Array.from(document.body.querySelectorAll<HTMLElement>(selector))
const byText = (selector: string, text: string) => all(selector).find((el) => el.textContent?.trim() === text)!
const click = (el: HTMLElement) => act(() => el.click())
function type(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', {bubbles: true}))
  })
}

describe('AppServerSelect', () => {
  it('names the chosen server by host alone, with the answer as its tooltip', () => {
    renderSelect('https://hyper.media/hm/api/apps')
    const trigger = one('button[aria-label="Server"]')
    expect(trigger.textContent).toBe('hyper.media')
    expect(trigger.textContent).not.toContain('/hm/api/apps')
    expect(trigger.title).toBe('Ready to run this app')
  })

  it('lists the known servers with their answers and picks one', () => {
    const onChange = renderSelect('https://hyper.media/hm/api/apps')
    click(one('button[aria-label="Server"]'))
    const rows = all('[role="option"]')
    expect(rows.map((row) => row.textContent)).toEqual(['hyper.media', 'This computer', 'closed.example'])
    expect(rows[2]?.title).toContain('Only someone who can write')
    expect(rows[0]?.getAttribute('aria-selected')).toBe('true')
    expect(one('button[aria-label="Forget closed.example"]')).toBeTruthy()
    click(rows[1]!)
    expect(onChange).toHaveBeenCalledWith('http://localhost:3051')
  })

  it('adds a server by host name, remembers it and chooses it', async () => {
    const onChange = renderSelect('')
    expect(one('button[aria-label="Server"]').textContent).toContain('Choose a server')
    click(one('button[aria-label="Server"]'))
    click(byText('button', 'Add a server…'))
    const input = one('input[aria-label="Server name"]') as HTMLInputElement
    type(input, 'nowhere.example')
    await act(async () => byText('button', 'Add').click())
    expect(one('[role="alert"]').textContent).toBe('No app server answers at nowhere.example')
    type(input, 'seed.example')
    await act(async () => byText('button', 'Add').click())
    expect(onChange).toHaveBeenCalledWith('https://seed.example/hm/api/apps')
    expect(remembered).toEqual(['https://seed.example/hm/api/apps'])
  })
})
