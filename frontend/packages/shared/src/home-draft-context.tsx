import {createContext, useContext} from 'react'

const HomeDraftContext = createContext<boolean | undefined>(undefined)

export const HomeDraftProvider = HomeDraftContext.Provider

export function useIsHomeDraftOverride(): boolean | undefined {
  return useContext(HomeDraftContext)
}
