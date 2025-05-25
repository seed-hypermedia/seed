import clsx from "clsx";
import {Activity, Globe, Monitor} from "lucide-react";
import {
  createBrowserRouter,
  NavLink,
  Outlet,
  RouterProvider,
} from "react-router-dom";
import "./App.css";
import Dashboard from "./components/Dashboard";
import ElectronPerformance from "./components/ElectronPerformance";
import {WebPerformance} from "./components/WebPerformance";

export default function App() {
  return <RouterProvider router={router} />;
}

const Layout = () => {
  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex">
              <div className="flex space-x-8">
                <NavLink
                  to="/"
                  className={({isActive}) =>
                    clsx(
                      "inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium",
                      isActive
                        ? "border-indigo-500 text-gray-900"
                        : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
                    )
                  }
                  end
                >
                  <Activity className="w-5 h-5 mr-2" />
                  Dashboard
                </NavLink>
                <NavLink
                  to="/electron"
                  className={({isActive}) =>
                    clsx(
                      "inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium",
                      isActive
                        ? "border-indigo-500 text-gray-900"
                        : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
                    )
                  }
                >
                  <Monitor className="w-5 h-5 mr-2" />
                  Electron
                </NavLink>
                <NavLink
                  to="/web"
                  className={({isActive}) =>
                    clsx(
                      "inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium",
                      isActive
                        ? "border-indigo-500 text-gray-900"
                        : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
                    )
                  }
                >
                  <Activity className="w-5 h-5 mr-2" />
                  Web App
                </NavLink>
                <NavLink
                  to="/landing"
                  className={({isActive}) =>
                    clsx(
                      "inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium",
                      isActive
                        ? "border-indigo-500 text-gray-900"
                        : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
                    )
                  }
                >
                  <Globe className="w-5 h-5 mr-2" />
                  Landing
                </NavLink>
              </div>
            </div>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto py-6 sm:px-6 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
};

const router = createBrowserRouter([
  {
    path: "/",
    element: <Layout />,
    children: [
      {
        path: "electron",
        element: <ElectronPerformance />,
      },
      {
        path: "web",
        element: <WebPerformance app="web" />,
      },
      {
        path: "landing",
        element: <WebPerformance app="landing" />,
      },
      {
        path: "/",
        element: <Dashboard />,
      },
    ],
  },
]);
