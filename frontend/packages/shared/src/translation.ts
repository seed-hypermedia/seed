import {ReactNode, useCallback} from 'react'
import {useUniversalAppContext} from './routing'
import {
  AnyTimestamp,
  formattedDateDayOnly as defaultFormattedDateDayOnly,
  formattedDateLong as defaultFormattedDateLong,
  formattedDateMedium as defaultFormattedDateMedium,
  formattedDateShort as defaultFormattedDateShort,
} from './utils'

export type LanguagePack = {
  translations: Record<string, string | ((args: any) => string)>
  formattedDateShort?: (date: AnyTimestamp) => string
  formattedDateLong?: (date: AnyTimestamp) => string
  formattedDateMedium?: (date: AnyTimestamp) => string
  formattedDateDayOnly?: (date: AnyTimestamp) => string
}

export function useTx() {
  const {languagePack} = useUniversalAppContext()
  return useCallback(
    <TranslationArgs>(
      enTextOrKey: string,
      enTextOrGetText?: string | ((args: TranslationArgs) => ReactNode),
      args?: TranslationArgs,
    ): ReactNode => {
      const def =
        languagePack?.translations?.[enTextOrKey] ??
        enTextOrGetText ??
        enTextOrKey
      if (def && typeof def === 'function') {
        if (!args) {
          throw new Error(
            'args are required when using a function as a translation',
          )
        }
        return (def as any)(args)
      }
      return def as any
    },
    [],
  )
}

export function useTxString() {
  const {languagePack} = useUniversalAppContext()
  return useCallback(
    <TranslationArgs>(
      enTextOrKey: string,
      enTextOrGetText?: string | ((args: TranslationArgs) => string),
      args?: TranslationArgs,
    ): string => {
      const def =
        languagePack?.translations?.[enTextOrKey] ??
        enTextOrGetText ??
        enTextOrKey
      if (def && typeof def === 'function') {
        if (!args) {
          throw new Error(
            'args are required when using a function as a translation',
          )
        }
        return (def as any)(args)
      }
      return def as any
    },
    [],
  )
}

export function useTxUtils() {
  const {languagePack} = useUniversalAppContext()
  const formattedDateLong =
    languagePack?.formattedDateLong || defaultFormattedDateLong
  const formattedDateMedium =
    languagePack?.formattedDateMedium || defaultFormattedDateMedium
  const formattedDateShort =
    languagePack?.formattedDateShort || defaultFormattedDateShort
  const formattedDateDayOnly =
    languagePack?.formattedDateDayOnly || defaultFormattedDateDayOnly
  return {
    formattedDateDayOnly,
    formattedDateMedium,
    formattedDateShort,
    formattedDateLong,
  }
}
