import {describe, expect, test} from 'vitest'
import {
  applyIsEvenAllocation,
  applyRecipientAmount,
  applyTotalAmount,
  evenToCustomAllocation,
  getAllocations,
  SHM_FEE,
} from '../payment-allocations'

function getFee(amount: number) {
  return Math.ceil(amount * SHM_FEE)
}
function amountWithFee(amount: number) {
  return amount + getFee(amount)
}

describe('getAllocations', () => {
  test('even split', () => {
    expect(
      getAllocations({
        mode: 'even',
        recipients: ['a', 'b'],
        amount: 200,
      }),
    ).toEqual({
      total: 200,
      recipients: [
        {account: 'a', amount: 99},
        {account: 'b', amount: 99},
      ],
      fee: 2,
      isEven: true,
    })
  })
  test('custom split', () => {
    expect(
      getAllocations({
        mode: 'custom',
        amounts: [
          {
            account: 'a',
            amount: 100,
            ratio: 0.5,
          },
          {
            account: 'b',
            amount: 50,
            ratio: 0.25,
          },
          {
            account: 'c',
            amount: 50,
            ratio: 0.25,
          },
        ],
      }),
    ).toEqual({
      total: 202,
      recipients: [
        {account: 'a', amount: 100, ratio: 0.5},
        {account: 'b', amount: 50, ratio: 0.25},
        {account: 'c', amount: 50, ratio: 0.25},
      ],
      fee: getFee(200),
      isEven: false,
    })
  })
})

describe('applyIsEvenAllocation', () => {
  test('convert even allocation to custom', () => {
    const result = applyIsEvenAllocation(false)({
      mode: 'even',
      recipients: ['a', 'b'],
      amount: 200,
    })
    expect(result).toEqual({
      mode: 'custom',
      amounts: [
        {account: 'a', amount: 99, ratio: 0.5},
        {account: 'b', amount: 99, ratio: 0.5},
      ],
    })
  })
  test('convert custom allocation to even', () => {
    const result = applyIsEvenAllocation(true)({
      mode: 'custom',
      amounts: [
        {
          account: 'a',
          amount: 10,
          ratio: -1, // this value is ignored for this test
        },
        {
          account: 'b',
          amount: 90,
          ratio: -1, // this value is ignored for this test
        },
      ],
    })
    expect(result).toEqual({
      mode: 'even',
      amount: 100 + SHM_FEE * 100, // the total should match and this was the total before, after the fee was applied
      recipients: ['a', 'b'],
    })
  })
})

describe('applyTotalAmount', () => {
  test('change amount when even', () => {
    const result = applyTotalAmount('300')({
      mode: 'even',
      recipients: ['a', 'b'],
      amount: 200,
    })
    expect(result).toEqual({
      mode: 'even',
      recipients: ['a', 'b'],
      amount: 300,
    })
  })
  test('change amount when custom - ratios retained', () => {
    const result = applyTotalAmount('300')({
      mode: 'custom',
      amounts: [
        {
          account: 'a',
          amount: 100,
          ratio: 0.5,
        },
        {
          account: 'b',
          amount: 50,
          ratio: 0.25,
        },
        {
          account: 'c',
          amount: 50,
          ratio: 0.25,
        },
      ],
    })
    expect(result).toEqual({
      mode: 'custom',
      amounts: [
        {
          account: 'a',
          amount: 148,
          ratio: 0.5,
        },
        {
          account: 'b',
          amount: 74,
          ratio: 0.25,
        },
        {
          account: 'c',
          amount: 74,
          ratio: 0.25,
        },
      ],
    })
    expect(getAllocations(result).total).toBe(299) // known issue (is this an issue?) where amount changes slightly due to the fee being applied
  })
  test('change custom total amount to 0', () => {
    const result = applyTotalAmount('')({
      mode: 'custom',
      amounts: [
        {
          account: 'a',
          amount: 100,
          ratio: 0.5,
        },
        {
          account: 'b',
          amount: 50,
          ratio: 0.25,
        },
        {
          account: 'c',
          amount: 50,
          ratio: 0.25,
        },
      ],
    })
    expect(result).toEqual({
      mode: 'custom',
      amounts: [
        {
          account: 'a',
          amount: 0,
          ratio: 0.5,
        },
        {
          account: 'b',
          amount: 0,
          ratio: 0.25,
        },
        {
          account: 'c',
          amount: 0,
          ratio: 0.25,
        },
      ],
    })
    expect(getAllocations(result).total).toBe(0)
  })
})

describe('evenToCustomAllocation', () => {
  test('convert even to custom', () => {
    const result = evenToCustomAllocation({
      mode: 'even',
      recipients: ['a', 'b'],
      amount: 202, // includes fee
    })
    expect(result).toEqual({
      mode: 'custom',
      amounts: [
        // does not include fee
        {account: 'a', amount: 100, ratio: 0.5},
        {account: 'b', amount: 100, ratio: 0.5},
      ],
    })
  })
})

describe.skip('applyRecipientAmount', () => {
  test('change recipient from even converts to custom', () => {
    const result = applyRecipientAmount(
      'a',
      '200',
    )({
      mode: 'even',
      recipients: ['a', 'b'],
      amount: 202,
    })
    expect(result).toEqual({
      mode: 'custom',
      amounts: [
        {
          account: 'a',
          amount: 200,
          ratio: 2 / 3,
        },
        {
          account: 'b',
          amount: 100,
          ratio: 1 / 3,
        },
      ],
    })
  })
})
