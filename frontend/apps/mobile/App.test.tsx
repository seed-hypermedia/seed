import React from 'react'
import renderer, {act, ReactTestRenderer} from 'react-test-renderer'
import App from './App'

describe('<App />', () => {
  it('renders correctly', async () => {
    let instance: ReactTestRenderer | undefined
    await act(async () => {
      instance = renderer.create(<App />)
    })
    expect(instance!.toJSON()).toBeTruthy()
  })

  it('renders without crashing', async () => {
    let instance: ReactTestRenderer | undefined
    await act(async () => {
      instance = renderer.create(<App />)
    })
    expect(instance!.toJSON()).not.toBeNull()
  })
})
