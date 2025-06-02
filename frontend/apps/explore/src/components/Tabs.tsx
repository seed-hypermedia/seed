import {labelOfEntityType, pluralS, UnpackedHypermediaId} from "@shm/shared";
import React from "react";

export type TabType =
  | "document"
  | "changes"
  | "comments"
  | "citations"
  | "capabilities"
  | "children";

interface TabProps {
  id: TabType;
  label: string;
  isActive: boolean;
  onClick: (tab: TabType) => void;
}

const Tab: React.FC<TabProps> = ({id, label, isActive, onClick}) => {
  return (
    <li role="presentation">
      <button
        className={`inline-block p-2 border-transparent whitespace-nowrap flex-shrink-0 ${
          isActive
            ? "text-blue-600 border-b-2 border-blue-600 border-0 rounded-none"
            : "hover:text-gray-600 border-none rounded-none"
        }`}
        onClick={() => onClick(id)}
        role="tab"
        aria-selected={isActive}
        aria-controls={`${id}-tab`}
      >
        {label}
      </button>
    </li>
  );
};

interface TabsProps {
  currentTab: TabType;
  id: UnpackedHypermediaId;
  onTabChange: (tab: TabType) => void;
  changeCount: number | undefined;
  commentCount: number | undefined;
  citationCount: number | undefined;
  capabilityCount: number | undefined;
  childrenCount: number | undefined;
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
}) => {
  const tabs: {id: TabType; label: string}[] = [
    {
      id: "document",
      label: `${labelOfEntityType(id.type)} State${
        id.version ? ` (Exact Version)` : ""
      }`,
    },
  ];
  if (id.type === "d") {
    tabs.push({
      id: "changes",
      label: `${changeCount} ${pluralS(changeCount, "Change")}`,
    });
    tabs.push({
      id: "comments",
      label: `${commentCount} ${pluralS(commentCount, "Comment")}`,
    });
    tabs.push({
      id: "citations",
      label: `${citationCount} ${pluralS(citationCount, "Citation")}`,
    });
    tabs.push({
      id: "capabilities",
      label: `${capabilityCount} ${pluralS(
        capabilityCount,
        "Capability",
        "Capabilities"
      )}`,
    });
    tabs.push({
      id: "children",
      label: `${childrenCount} ${pluralS(childrenCount, "Child", "Children")}`,
    });
  }

  return (
    <div className="mb-4 border-b border-gray-200">
      <ul
        className="flex px-2 overflow-x-auto text-sm font-medium text-center flex-nowrap md:px-0"
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
  );
};

export default Tabs;
