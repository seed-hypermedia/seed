import {useState} from "react";
import "./App.css";
import Settings from "./components/Settings";
import {getApiHost, setApiHost} from "./utils/apiHost";

function App() {
  const [apiHost, setApiHostState] = useState(getApiHost());

  const handleApiHostChange = (newHost: string) => {
    setApiHost(newHost);
    setApiHostState(newHost);
  };

  return (
    <div className="min-h-screen bg-gray-100 py-6 flex flex-col justify-center sm:py-12">
      <div className="relative py-3 sm:max-w-xl sm:mx-auto">
        <div className="relative px-4 py-10 bg-white shadow-lg sm:rounded-3xl sm:p-20">
          <div className="max-w-md mx-auto">
            <div className="divide-y divide-gray-200">
              <div className="py-8 text-base leading-6 space-y-4 text-gray-700 sm:text-lg sm:leading-7">
                <h1 className="text-3xl font-bold text-gray-900 mb-8">
                  Welcome to Explore
                </h1>
                <p className="text-gray-600">
                  This is a new Vite + React + Tailwind app. Start building
                  something amazing!
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <Settings apiHost={apiHost} onApiHostChange={handleApiHostChange} />
    </div>
  );
}

export default App;
