import React, {createContext, useContext, useState} from 'react'

// Context to keep track of which embed link toolbar is showing
const EmbedToolbarContext = createContext<{
  activeId: string | null
  setActiveId: (id: string | null) => void
} | null>(null)

export const EmbedToolbarProvider: React.FC<{children: React.ReactNode}> = ({
  children,
}) => {
  const [activeId, setActiveId] = useState<string | null>(null)

  return (
    <EmbedToolbarContext.Provider value={{activeId, setActiveId}}>
      {children}
    </EmbedToolbarContext.Provider>
  )
}

export const useEmbedToolbarContext = () => {
  const context = useContext(EmbedToolbarContext)
  if (!context) {
    throw new Error('useToolbarContext must be used within a ToolbarProvider')
  }
  return context
}
