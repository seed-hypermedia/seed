import {Settings as SettingsIcon} from 'lucide-react'
import {useEffect, useState, useSyncExternalStore} from 'react'
import {getSnapshot, subscribe, updateApiHost} from '../apiHostStore'

export default function Settings() {
  const [isOpen, setIsOpen] = useState(false)
  const apiHost = useSyncExternalStore(subscribe, getSnapshot)
  const [inputValue, setInputValue] = useState(apiHost)

  useEffect(() => {
    setInputValue(apiHost)
  }, [apiHost])

  const handleSave = () => {
    updateApiHost(inputValue)
    setIsOpen(false)
  }

  return (
    <div className="fixed bottom-4 left-4 z-10">
      <div className="flex items-center rounded-lg bg-white p-2 shadow-md">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="rounded-full bg-gray-200 p-2 transition-colors hover:bg-gray-300"
          aria-label="Settings"
        >
          <SettingsIcon className="h-5 w-5 text-gray-600" />
        </button>
        <div className="ml-2 flex flex-col">
          <span className="text-xs font-medium text-gray-500">
            Hypermedia API
          </span>
          <span className="text-sm text-gray-500">{apiHost}</span>
        </div>
      </div>

      {isOpen && (
        <div className="absolute bottom-12 left-0 w-80 rounded-lg border border-gray-200 bg-white p-4 shadow-xl">
          <h3 className="mb-4 text-lg font-medium text-gray-900">Settings</h3>
          <div className="mb-4">
            <label
              htmlFor="apiHost"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Explore API Host
            </label>
            <input
              type="text"
              id="apiHost"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 focus:outline-none"
              placeholder="Enter API host URL"
            />
          </div>
          <div className="flex justify-end space-x-2">
            <button
              onClick={() => setIsOpen(false)}
              className="rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 focus:outline-none"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 focus:outline-none"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
