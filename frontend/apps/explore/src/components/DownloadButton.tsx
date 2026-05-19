import React from 'react'
import {Download} from 'lucide-react'

interface DownloadButtonProps {
  url: string
}

export const DownloadButton: React.FC<DownloadButtonProps> = ({url}) => {
  const handleDownload = () => {
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  return (
    <button
      onClick={handleDownload}
      className="ml-2 p-2 text-gray-500 transition-colors hover:text-gray-700"
      title="Download"
    >
      <Download className="size-4" />
    </button>
  )
}
