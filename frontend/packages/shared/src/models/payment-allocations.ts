export type PaymentAllocationEven = {
  mode: 'even'
  amount: number
  recipients: string[]
}
export type PaymentAllocationCustom = {
  mode: 'custom'
  amounts: {
    account: string
    amount: number // number of SATS for this recipient
    // amount of the sub-total this recipient should get. the ratio of all amounts/recipients add up to 1
    ratio: number // ratio is used as a fallback only! this is used to preserve when the amounts are all zero, for example when the user temporarily deletes the total amount during custom allocation
  }[]
}
export type PaymentAllocation = PaymentAllocationEven | PaymentAllocationCustom

export const SHM_FEE = 0.01

export const DEFAULT_PAYMENT_AMOUNTS: number[] = [1_000, 5_000, 10_000]

export function evenToCustomAllocation(
  allocation: PaymentAllocationEven,
): PaymentAllocationCustom {
  const prevSubtotal = allocation.amount / (1 + SHM_FEE)
  // console.log('prevFee', prevFee)
  // const prevSubtotal = allocation.amount - prevFee
  const amountForEach = Math.floor(prevSubtotal / allocation.recipients.length)
  const amounts = allocation.recipients.map((recipient) => {
    return {
      account: recipient,
      amount: amountForEach,
      ratio: 1 / allocation.recipients.length,
    }
  })
  return {mode: 'custom', amounts}
}

export function getAllocations(allocation: PaymentAllocation): {
  fee: number
  recipients: {account: string; amount: number}[]
  total: number
  isEven: boolean
} {
  if (allocation.mode === 'even') {
    const forEachRecipient = Math.floor(
      (allocation.amount * (1 - SHM_FEE)) / allocation.recipients.length,
    )
    const fee =
      allocation.amount - forEachRecipient * allocation.recipients.length
    const recipients = allocation.recipients.map((recipient) => {
      return {account: recipient, amount: forEachRecipient}
    })
    return {
      total: allocation.amount,
      recipients,
      fee,
      isEven: true,
    }
  }
  if (allocation.mode === 'custom') {
    const subTotal = allocation.amounts.reduce(
      (acc, {amount}) => acc + amount,
      0,
    )
    const fee = Math.ceil(subTotal * SHM_FEE)
    return {
      total: subTotal + fee,
      fee,
      recipients: allocation.amounts,
      isEven: false,
    }
  }
  throw new Error('Invalid allocation mode')
}

export function applyIsEvenAllocation(isEven: boolean) {
  return (allocation: PaymentAllocation): PaymentAllocation => {
    if (allocation.mode === 'even') {
      if (isEven) return allocation
      return evenToCustomAllocation(allocation)
    }
    if (allocation.mode === 'custom') {
      if (!isEven) return allocation
      // converting custom allocation into even. preserve total amount
      const subTotal = allocation.amounts.reduce(
        (acc, {amount}) => acc + amount,
        0,
      )
      const fee = Math.ceil(subTotal * SHM_FEE)
      const total = subTotal + fee
      return {
        mode: 'even',
        amount: total,
        recipients: allocation.amounts.map(({account}) => account),
      }
    }
    // todo
    throw new Error('Invalid allocation mode')
  }
}

export function applyTotalAmount(amountString: string) {
  return (allocation: PaymentAllocation): PaymentAllocation => {
    const amount = Number(amountString)
    if (isNaN(amount)) return allocation
    if (allocation.mode === 'even') {
      return {...allocation, amount}
    }
    if (allocation.mode === 'custom') {
      const newEstimatedSubtotal = amount * (1 - SHM_FEE) // this is an estimate due to questionable rounding. this may be a bug?!
      const amounts = allocation.amounts.map(({account, ratio}) => ({
        account,
        ratio,
        amount: Math.floor(newEstimatedSubtotal * ratio),
      }))
      return {...allocation, amounts}
    }
    throw new Error('Invalid allocation mode')
  }
}

export function applyRecipientAmount(
  recipientId: string,
  amountString: string,
) {
  return (allocation: PaymentAllocation): PaymentAllocation => {
    const amount = Number(amountString)
    if (isNaN(amount)) return allocation
    const customAlloc =
      allocation.mode === 'custom'
        ? allocation
        : evenToCustomAllocation(allocation)
    console.log('customAlloc', customAlloc)
    const totalAllocFunds = customAlloc.amounts.reduce(
      (acc, a) => (acc + a.account === recipientId ? amount : a.amount),
      0,
    )
    const amounts = customAlloc.amounts.map((a) => {
      if (a.account === recipientId)
        return {account: a.account, amount, ratio: amount / totalAllocFunds}
      return {...a, ratio: a.amount / totalAllocFunds}
    })
    return {...customAlloc, amounts}
  }
}
