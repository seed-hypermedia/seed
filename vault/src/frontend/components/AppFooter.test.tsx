import {render, screen} from '@testing-library/react'
import {describe, expect, test} from 'bun:test'
import {AppFooter} from '@/frontend/components/AppFooter'

describe('AppFooter', () => {
  test('shows the notification server URL', () => {
    render(<AppFooter notificationServerUrl="https://notify.example.com" />)

    expect(screen.getByText('Notification server URL')).toBeDefined()
    const link = screen.getByRole('link', {name: 'https://notify.example.com'})
    expect(link.getAttribute('href')).toBe('https://notify.example.com')
  })
})
