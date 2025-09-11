import React, {createContext, useContext} from 'react'

interface WebSigningContextType {
  enableWebSigning: boolean
}

const WebSigningContext = createContext<WebSigningContextType>({
  enableWebSigning: false,
})

export function WebSigningProvider({
  enableWebSigning,
  children,
}: {
  enableWebSigning: boolean
  children: React.ReactNode
}) {
  return (
    <WebSigningContext.Provider value={{enableWebSigning}}>
      {children}
    </WebSigningContext.Provider>
  )
}

export function useWebSigning() {
  return useContext(WebSigningContext)
}
