import {describe, expect, it} from 'vitest'
import {loader} from '../routes/hm.notifications'

describe('notifications route', () => {
  it('redirects to the site Activity page on the To you tab', () => {
    const response = loader()
    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toBe('/:feed/to-you')
  })
})
