import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {pluralS} from '@shm/shared'
import React from 'react'

/** Supported Explore tabs for a resource page. */
export type TabType =
  | 'document'
  | 'changes'
  | 'versions'
  | 'comments'
  | 'citations'
  | 'capabilities'
  | 'children'
  | 'authored-comments'

type ResourceType = 'document' | 'comment' | 'redirect' | 'not-found' | 'tombstone' | 'error' | undefined

/** Tab metadata used to render the Explore tab bar. */
export interface TabDefinition {
  id: TabType
  label: string
}

interface TabCounts {
  changeCount?: number
  versionCount?: number
  commentCount?: number
  citationCount?: number
  capabilityCount?: number
  childrenCount?: number
  authoredCommentCount?: number
}

/** Builds the tab list for a resource based on its resolved type and query counts. */
export function getTabs({
  id,
  resourceType,
  changeCount = 0,
  versionCount = 0,
  commentCount = 0,
  citationCount = 0,
  capabilityCount = 0,
  childrenCount = 0,
  authoredCommentCount = 0,
}: {id: UnpackedHypermediaId; resourceType?: ResourceType} & TabCounts): TabDefinition[] {
  const tabs: TabDefinition[] = [
    {
      id: 'document',
      label: `Document State${id.version ? ` (Exact Version)` : ''}`,
    },
  ]

  if (resourceType === 'document') {
    tabs.push({
      id: 'changes',
      label: `${changeCount} ${pluralS(changeCount, 'Change')}`,
    })
  }

  if (resourceType === 'comment') {
    tabs.push({
      id: 'versions',
      label: `${versionCount} ${pluralS(versionCount, 'Version')}`,
    })
  }

  tabs.push({
    id: 'comments',
    label: `${commentCount} ${pluralS(commentCount, 'Comment')}`,
  })
  if (resourceType === 'document' || resourceType === 'comment') {
    tabs.push({
      id: 'citations',
      label: `${citationCount} ${pluralS(citationCount, 'Citation')}`,
    })
  }
  tabs.push({
    id: 'capabilities',
    label: `${capabilityCount} ${pluralS(capabilityCount, 'Capability', 'Capabilities')}`,
  })
  tabs.push({
    id: 'children',
    label: `${childrenCount} ${pluralS(childrenCount, 'Child', 'Children')}`,
  })

  if (!id.path?.filter((p) => !!p).length) {
    tabs.push({
      id: 'authored-comments',
      label: `${authoredCommentCount} ${pluralS(authoredCommentCount, 'Authored Comment', 'Authored Comments')}`,
    })
  }

  return tabs
}

/** Falls back to the document tab when the requested tab is unavailable for the resource. */
export function getSafeCurrentTab(currentTab: string | null | undefined, tabs: TabDefinition[]): TabType {
  return tabs.some((tab) => tab.id === currentTab) ? (currentTab as TabType) : 'document'
}

/** Returns updated search params while preserving the current version and other filters. */
export function getTabSearchParams(searchParams: URLSearchParams, tab: TabType) {
  const nextSearchParams = new URLSearchParams(searchParams)
  nextSearchParams.set('tab', tab)
  return nextSearchParams
}

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
  resourceType?: ResourceType
  onTabChange: (tab: TabType) => void
  changeCount: number | undefined
  versionCount: number | undefined
  commentCount: number | undefined
  citationCount: number | undefined
  capabilityCount: number | undefined
  childrenCount: number | undefined
  authoredCommentCount: number | undefined
}

const Tabs: React.FC<TabsProps> = ({
  id,
  currentTab,
  resourceType,
  onTabChange,
  changeCount = 0,
  versionCount = 0,
  commentCount = 0,
  citationCount = 0,
  capabilityCount = 0,
  childrenCount = 0,
  authoredCommentCount = 0,
}) => {
  const tabs = getTabs({
    id,
    resourceType,
    changeCount,
    versionCount,
    commentCount,
    citationCount,
    capabilityCount,
    childrenCount,
    authoredCommentCount,
  })

  return (
    <div className="mb-4 border-b border-gray-200">
      <ul className="flex flex-nowrap overflow-x-auto px-2 text-center text-sm font-medium md:px-0" role="tablist">
        {tabs.map((tab) => (
          <Tab key={tab.id} id={tab.id} label={tab.label} isActive={currentTab === tab.id} onClick={onTabChange} />
        ))}
      </ul>
    </div>
  )
}

export default Tabs
