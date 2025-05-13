import {createContext, useContext} from 'react'

const defaultDiscussionsContext = {
  onReplyClick: (replyCommentId: string, rootReplyCommentId: string) => {
    console.log(
      'onReplyClick not implemented',
      replyCommentId,
      rootReplyCommentId,
    )
  },
  onReplyCountClick: (replyCommentId: string, rootReplyCommentId: string) => {
    console.log(
      'onReplyCountClick not implemented',
      replyCommentId,
      rootReplyCommentId,
    )
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
  onReplyClick?: (replyCommentId: string, rootReplyCommentId: string) => void
  onReplyCountClick?: (
    replyCommentId: string,
    rootReplyCommentId: string,
  ) => void
}) {
  return (
    <DiscussionsContext.Provider value={{onReplyClick, onReplyCountClick}}>
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
