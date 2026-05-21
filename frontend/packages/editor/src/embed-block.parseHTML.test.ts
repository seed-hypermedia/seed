import {describe, expect, it} from 'vitest'

import {vi} from 'vitest'

vi.mock('./blocknote/react', () => ({
  createReactBlockSpec: (spec: any) => spec,
}))

import {EmbedBlock} from './embed-block'

describe('EmbedBlock.parseHTML', () => {
  it('claims SSR embed card anchors before generic link parsing', () => {
    expect(EmbedBlock.parseHTML).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tag: 'a[data-content-type=embed]',
          priority: 1001,
        }),
      ]),
    )
  })
})
