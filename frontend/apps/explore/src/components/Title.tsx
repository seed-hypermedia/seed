import React from 'react'

interface TitleProps {
  title: string
  className?: string
  buttons?: React.ReactNode
}

export const Title: React.FC<TitleProps> = ({
  title,
  className = '',
  buttons,
}) => {
  // strip off trailing slash
  const displayTitle = title.replace(/\/$/, '')
  return (
    <div className={`flex w-full flex-wrap items-center gap-2 ${className}`}>
      <h1 className="min-w-0 flex-grow overflow-hidden text-2xl font-bold break-words">
        {displayTitle}
      </h1>
      {buttons && <div className="flex flex-shrink-0">{buttons}</div>}
    </div>
  )
}
