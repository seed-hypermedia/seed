import React from 'react'
import {FiExternalLink} from 'react-icons/fi'

interface ExternalOpenButtonProps {
  url: string
}

export const ExternalOpenButton: React.FC<ExternalOpenButtonProps> = ({
  url,
}) => {
  const handleClick = () => {
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <button
      onClick={handleClick}
      className="ml-2 p-2 text-gray-500 transition-colors hover:text-gray-700"
      title="Open in new tab"
    >
      <FiExternalLink />
    </button>
  )
}

export const OpenInAppButton: React.FC<ExternalOpenButtonProps> = ({url}) => {
  const handleClick = () => {
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <button
      onClick={handleClick}
      className="ml-2 p-2 text-green-500 transition-colors hover:text-green-700"
      title="Open in Seed App"
    >
      <FiExternalLink />
    </button>
  )
}
