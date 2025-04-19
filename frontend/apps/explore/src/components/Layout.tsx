import {Link, Outlet} from "react-router-dom";
import HMLogo from "../assets/HMLogo.svg";

export default function Layout() {
  return (
    <div className="flex flex-col w-screen min-h-screen bg-gray-100">
      <header className="sticky top-0 z-10 w-full bg-white shadow">
        <div className="w-full px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex">
              <div className="flex items-center">
                <Link
                  to="/"
                  className="flex items-center text-xl font-bold text-gray-800"
                >
                  <img src={HMLogo} alt="HM Logo" className="w-auto h-8 mr-2" />
                  Hypermedia Explorer
                </Link>
              </div>
              <nav className="flex ml-6 space-x-8">
                <Link
                  to="/list"
                  className="inline-flex items-center px-1 pt-1 text-gray-900 border-b-2 border-transparent hover:border-gray-300"
                >
                  All Sites
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
