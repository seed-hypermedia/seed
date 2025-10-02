import React from 'react'
import {NavigateFunction} from 'react-router-dom'
import {DataViewer} from '../DataViewer'

interface DocumentTabProps {
  data: any
  onNavigate: NavigateFunction
}

const DocumentTab: React.FC<DocumentTabProps> = ({data, onNavigate}) => {
  return data ? <DataViewer data={data} onNavigate={onNavigate} /> : null
}

export default DocumentTab
