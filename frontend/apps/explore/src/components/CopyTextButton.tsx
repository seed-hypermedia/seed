import React from 'react'
import {FiCopy} from 'react-icons/fi'

interface CopyTextButtonProps {
  text: string
}

export const CopyTextButton: React.FC<CopyTextButtonProps> = ({text}) => {
  const handleCopy = () => {
    navigator.clipboard.writeText(text)
  }

  return (
    <button
      onClick={handleCopy}
      className="ml-2 p-2 text-gray-500 transition-colors hover:text-gray-700"
      title="Copy to clipboard"
    >
      <FiCopy />
    </button>
  )
}
