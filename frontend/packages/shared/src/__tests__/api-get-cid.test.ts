import {describe, expect, it, vi} from 'vitest'
import {GetCID} from '../api-get-cid'

describe('GetCID', () => {
  it('fetches DAG JSON from the public IPFS route', async () => {
    const queryDaemon = vi.fn().mockResolvedValue({hello: 'world'})

    const result = await GetCID.getData({} as any, {cid: 'bafytest'}, queryDaemon)

    expect(queryDaemon).toHaveBeenCalledWith('/ipfs/bafytest.dagjson')
    expect(result).toEqual({value: {hello: 'world'}})
  })
})
