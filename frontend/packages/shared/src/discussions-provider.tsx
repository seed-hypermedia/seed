import {createContext, useContext, useMemo} from 'react'
import {HMComment} from './hm-types'

const defaultDiscussionsContext = {
  onReplyClick: (replyComment: HMComment) => {
    console.log('onReplyClick not implemented', replyComment)
  },
  onReplyCountClick: (replyComment: HMComment) => {
    console.log('onReplyCountClick not implemented', replyComment)
  },
}

const DiscussionsContext = createContext<typeof defaultDiscussionsContext>(
  defaultDiscussionsContext,
)

export function DiscussionsProvider({
  children,
  onReplyClick = defaultDiscussionsContext.onReplyClick,
  onReplyCountClick = defaultDiscussionsContext.onReplyCountClick,
}: {
  children: React.ReactNode
  onReplyClick?: (replyComment: HMComment) => void
  onReplyCountClick?: (replyComment: HMComment) => void
}) {
  return (
    <DiscussionsContext.Provider
      value={useMemo(
        () => ({onReplyClick, onReplyCountClick}),
        [onReplyClick, onReplyCountClick],
      )}
    >
      {children}
    </DiscussionsContext.Provider>
  )
}

export function useDiscussionsContext() {
  const context = useContext(DiscussionsContext)
  if (!context) {
    throw new Error('DiscussionsContext not found')
  }
  return context
}
