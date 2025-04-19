import {useEffect, useState, useSyncExternalStore} from "react";
import {getSnapshot, subscribe, updateApiHost} from "../apiHostStore";

export default function Settings() {
  const [isOpen, setIsOpen] = useState(false);
  const apiHost = useSyncExternalStore(subscribe, getSnapshot);
  const [inputValue, setInputValue] = useState(apiHost);

  useEffect(() => {
    setInputValue(apiHost);
  }, [apiHost]);

  const handleSave = () => {
    updateApiHost(inputValue);
    setIsOpen(false);
  };

  return (
    <div className="fixed z-10 bottom-4 left-4">
      <div className="flex items-center space-x-2">
        <span className="text-sm text-gray-500">{apiHost}</span>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="p-2 transition-colors bg-gray-200 rounded-full hover:bg-gray-300"
          aria-label="Settings"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="w-5 h-5 text-gray-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
            />
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
            />
          </svg>
        </button>
      </div>

      {isOpen && (
        <div className="absolute left-0 p-4 bg-white border border-gray-200 rounded-lg shadow-xl bottom-12 w-80">
          <h3 className="mb-4 text-lg font-medium text-gray-900">Settings</h3>
          <div className="mb-4">
            <label
              htmlFor="apiHost"
              className="block mb-1 text-sm font-medium text-gray-700"
            >
              Explore API Host
            </label>
            <input
              type="text"
              id="apiHost"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
              placeholder="Enter API host URL"
            />
          </div>
          <div className="flex justify-end space-x-2">
            <button
              onClick={() => setIsOpen(false)}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
