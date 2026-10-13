import * as rtl from '@testing-library/react'
import {afterEach, expect, mock, test} from 'bun:test'
import {Button} from './button'

afterEach(() => rtl.cleanup())

test('loading prevents clicks even when the form passes disabled=false', () => {
  const onClick = mock()
  const {rerender} = rtl.render(
    <Button loading disabled={false} onClick={onClick}>
      Verify
    </Button>,
  )
  const button = rtl.screen.getByRole('button', {name: 'Verify'}) as HTMLButtonElement
  expect(button.disabled).toBe(true)
  rtl.fireEvent.click(button)
  expect(onClick).not.toHaveBeenCalled()
  rerender(
    <Button loading={false} disabled={false} onClick={onClick}>
      Verify
    </Button>,
  )
  expect(button.disabled).toBe(false)
  rtl.fireEvent.click(button)
  expect(onClick).toHaveBeenCalledTimes(1)
})
