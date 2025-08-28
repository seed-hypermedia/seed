import {pluralS, UnpackedHypermediaId} from '@shm/shared'
import React from 'react'

export type TabType =
  | 'document'
  | 'changes'
  | 'comments'
  | 'citations'
  | 'capabilities'
  | 'children'
  | 'authored-comments'

interface TabProps {
  id: TabType
  label: string
  isActive: boolean
  onClick: (tab: TabType) => void
}

const Tab: React.FC<TabProps> = ({id, label, isActive, onClick}) => {
  return (
    <li role="presentation">
      <button
        className={`inline-block flex-shrink-0 border-transparent p-2 whitespace-nowrap ${
          isActive
            ? 'rounded-none border-0 border-b-2 border-blue-600 text-blue-600'
            : 'rounded-none border-none hover:text-gray-600'
        }`}
        onClick={() => onClick(id)}
        role="tab"
        aria-selected={isActive}
        aria-controls={`${id}-tab`}
      >
        {label}
      </button>
    </li>
  )
}

interface TabsProps {
  currentTab: TabType
  id: UnpackedHypermediaId
  onTabChange: (tab: TabType) => void
  changeCount: number | undefined
  commentCount: number | undefined
  citationCount: number | undefined
  capabilityCount: number | undefined
  childrenCount: number | undefined
  authoredCommentCount: number | undefined
}

const Tabs: React.FC<TabsProps> = ({
  id,
  currentTab,
  onTabChange,
  changeCount = 0,
  commentCount = 0,
  citationCount = 0,
  capabilityCount = 0,
  childrenCount = 0,
  authoredCommentCount = 0,
}) => {
  const tabs: {id: TabType; label: string}[] = [
    {
      id: 'document',
      label: `Document State${id.version ? ` (Exact Version)` : ''}`,
    },
  ]
  tabs.push({
    id: 'changes',
    label: `${changeCount} ${pluralS(changeCount, 'Change')}`,
  })
  tabs.push({
    id: 'comments',
    label: `${commentCount} ${pluralS(commentCount, 'Comment')}`,
  })
  tabs.push({
    id: 'citations',
    label: `${citationCount} ${pluralS(citationCount, 'Citation')}`,
  })
  tabs.push({
    id: 'capabilities',
    label: `${capabilityCount} ${pluralS(
      capabilityCount,
      'Capability',
      'Capabilities',
    )}`,
  })
  tabs.push({
    id: 'children',
    label: `${childrenCount} ${pluralS(childrenCount, 'Child', 'Children')}`,
  })
  if (!id.path?.filter((p) => !!p).length) {
    tabs.push({
      id: 'authored-comments',
      label: `${authoredCommentCount} ${pluralS(
        authoredCommentCount,
        'Authored Comment',
        'Authored Comments',
      )}`,
    })
  }

  return (
    <div className="mb-4 border-b border-gray-200">
      <ul
        className="flex flex-nowrap overflow-x-auto px-2 text-center text-sm font-medium md:px-0"
        role="tablist"
      >
        {tabs.map((tab) => (
          <Tab
            key={tab.id}
            id={tab.id}
            label={tab.label}
            isActive={currentTab === tab.id}
            onClick={onTabChange}
          />
        ))}
      </ul>
    </div>
  )
}

export default Tabs
