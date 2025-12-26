import React from 'react'
import renderer from 'react-test-renderer'
import App from './App'

describe('<App />', () => {
  it('renders correctly', () => {
    const tree = renderer.create(<App />).toJSON()
    expect(tree).toBeTruthy()
  })

  it('renders without crashing', () => {
    const instance = renderer.create(<App />)
    expect(instance.toJSON()).not.toBeNull()
  })
})
