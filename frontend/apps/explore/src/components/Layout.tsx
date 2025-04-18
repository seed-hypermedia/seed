import {Link, Outlet} from "react-router-dom";

export default function Layout() {
  return (
    <div className="min-h-screen w-screen flex flex-col bg-gray-100">
      <header className="sticky top-0 z-10 w-full bg-white shadow">
        <div className="w-full px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex">
              <div className="flex items-center">
                <Link to="/" className="text-xl font-bold text-gray-800">
                  Explore
                </Link>
              </div>
              <nav className="ml-6 flex space-x-8">
                <Link
                  to="/"
                  className="inline-flex items-center px-1 pt-1 text-gray-900 border-b-2 border-transparent hover:border-gray-300"
                >
                  Home
                </Link>
                <Link
                  to="/list"
                  className="inline-flex items-center px-1 pt-1 text-gray-900 border-b-2 border-transparent hover:border-gray-300"
                >
                  List
                </Link>
              </nav>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 w-full px-4 py-6 sm:px-6 lg:px-8">
        <div className="w-full">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
