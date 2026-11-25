import {describe, expect, it} from 'vitest'
import {isViewTermPath} from '../entity-id-url'

describe('isViewTermPath', () => {
  it('matches panel URLs in every form a link takes', () => {
    expect(isViewTermPath('/hm/z6MkA/:followers/z6MkB')).toBe(true)
    expect(isViewTermPath('/authors/jane/:comments')).toBe(true)
    expect(isViewTermPath('/:activity/citations')).toBe(true)
    expect(isViewTermPath('https://katt2.hyper.media/:membership/z6MkB?l')).toBe(true)
  })

  it('leaves documents alone, including names that merely contain a colon or a term', () => {
    expect(isViewTermPath('/hm/z6MkA/papers/openai-estimate')).toBe(false)
    expect(isViewTermPath('https://example.org/')).toBe(false)
    expect(isViewTermPath('/notes/followers')).toBe(false)
    expect(isViewTermPath('/doc?panel=:comments')).toBe(false)
    expect(isViewTermPath('/doc#:activity')).toBe(false)
  })
})
