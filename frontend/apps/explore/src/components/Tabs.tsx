import React from "react";

export type TabType =
  | "document"
  | "changes"
  | "comments"
  | "citations"
  | "capabilities";

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
        className={`inline-block p-2 border-transparent ${
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
  onTabChange: (tab: TabType) => void;
}

const Tabs: React.FC<TabsProps> = ({currentTab, onTabChange}) => {
  const tabs: {id: TabType; label: string}[] = [
    {id: "document", label: "Document State"},
    {id: "changes", label: "Changes"},
    {id: "comments", label: "Comments"},
    {id: "citations", label: "Citations"},
    {id: "capabilities", label: "Capabilities"},
  ];

  return (
    <div className="mb-4 border-b border-gray-200">
      <ul className="flex text-sm font-medium text-center" role="tablist">
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
