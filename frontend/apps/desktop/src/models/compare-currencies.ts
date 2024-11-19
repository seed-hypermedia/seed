import {queryKeys} from '@shm/shared'
import {useQuery} from '@tanstack/react-query'

export const displayCurrencies = [
  {
    code: 'usd',
    name: 'US Dollar',
    character: '$',
    precision: 2,
  },
  {
    code: 'eur',
    name: 'Euro',
    character: '€',
    precision: 2,
  },
  {
    code: 'jpy',
    name: 'Japanese Yen',
    character: '¥',
    precision: 0,
  },
  {
    code: 'gbp',
    name: 'British Pound',
    character: '£',
    precision: 2,
  },
  {
    code: 'aud',
    name: 'Australian Dollar',
    character: 'A$',
    precision: 2,
  },
  {
    code: 'cad',
    name: 'Canadian Dollar',
    character: 'C$',
    precision: 2,
  },
  {
    code: 'chf',
    name: 'Swiss Franc',
    character: 'CHF',
    precision: 2,
  },
  {
    code: 'cny',
    name: 'Chinese Yuan',
    character: '¥',
    precision: 2,
  },
  {
    code: 'sek',
    name: 'Swedish Krona',
    character: 'kr',
    precision: 2,
  },
  {
    code: 'nzd',
    name: 'New Zealand Dollar',
    character: 'NZ$',
    precision: 2,
  },
] as const

// all currencies that coingeko will compare to:
// const allAvailableComparisonCurrencies = {
//   usd: 'US Dollar', // #1
//   eur: 'Euro', // #2
//   aed: 'UAE Dirham',
//   ars: 'Argentine Peso',
//   aud: 'Australian Dollar',
//   bdt: 'Taka',
//   bhd: 'Bahraini Dinar',
//   bmd: 'Bermudian Dollar',
//   brl: 'Brazilian Real',
//   cad: 'Canadian Dollar',
//   chf: 'Swiss Franc',
//   clp: 'Chilean Peso',
//   cny: 'Yuan Renminbi',
//   czk: 'Czech Koruna',
//   dkk: 'Danish Krone',
//   gbp: 'Pound Sterling',
//   gel: 'Lari',
//   hkd: 'Hong Kong Dollar',
//   huf: 'Forint',
//   idr: 'Rupiah',
//   ils: 'New Israeli Sheqel',
//   inr: 'Indian Rupee',
//   jpy: 'Yen',
//   krw: 'Won',
//   kwd: 'Kuwaiti Dinar',
//   lkr: 'Sri Lanka Rupee',
//   mmk: 'Kyat',
//   mxn: 'Mexican Peso',
//   myr: 'Malaysian Ringgit',
//   ngn: 'Naira',
//   nok: 'Norwegian Krone',
//   nzd: 'New Zealand Dollar',
//   php: 'Philippine Peso',
//   pkr: 'Pakistan Rupee',
//   pln: 'Zloty',
//   rub: 'Russian Ruble',
//   sar: 'Saudi Riyal',
//   sek: 'Swedish Krona',
//   sgd: 'Singapore Dollar',
//   thb: 'Baht',
//   try: 'Turkish Lira',
//   twd: 'New Taiwan Dollar',
//   uah: 'Hryvnia',
//   vef: 'Bolivar Fuerte',
//   vnd: 'Dong',
//   zar: 'Rand',
//   // ?
//   // xdr: 'SDR (Special Drawing Right)',
//   // xag: 'Silver',
//   // xau: 'Gold',
// } as const

const compareAPIUrl = `https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=${displayCurrencies
  .map((c) => c.code)
  .join(',')}&precision=full`

async function compareCurrencies() {
  const response = await fetch(compareAPIUrl)
  const data = await response.json()
  return displayCurrencies
    .map(({code, name, character, precision}) => {
      const perBTC = data.bitcoin[code] as number | undefined
      if (!perBTC) return null
      return {
        code,
        name,
        perBTC,
        character,
        precision,
      }
    })
    .filter((c) => !!c)
}

const SATS_PER_BTC = 100_000_000

export function useCurrencyComparisons(sats: number) {
  const comparisonQuery = useQuery({
    queryKey: [queryKeys.CURRENCY_COMPARISONS],
    queryFn: compareCurrencies,
    refetchInterval: 2 * 60 * 1000, // 2 minutes polling
  })
  return (
    comparisonQuery.data?.map((currency) => {
      const value = (currency.perBTC * sats) / SATS_PER_BTC
      return {
        ...currency,
        value,
      }
    }) || []
  )
}
