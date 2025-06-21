import {Link, Outlet} from 'react-router-dom'
import HMLogo from '../assets/HMLogo.svg'

export default function Layout() {
  return (
    <div className="flex flex-col w-screen min-h-screen bg-gray-100">
      <header className="fixed top-0 left-0 right-0 w-full px-4 sm:px-8 py-4 flex items-center justify-between border-b border-gray-200 bg-white z-40 shadow-sm">
        <Link to="/" className="flex items-center space-x-2">
          <img src={HMLogo} alt="HM Logo" className="w-5 h-5 sm:w-6 sm:h-6" />
          <span className="text-base sm:text-lg font-semibold bg-gradient-to-r from-blue-600 to-purple-600 text-transparent bg-clip-text whitespace-nowrap">
            Hypermedia Explorer
          </span>
        </Link>

        <nav className="flex space-x-6 text-sm font-medium text-gray-700">
          <Link
            to="/list"
            className="hover:text-black transition whitespace-nowrap"
          >
            All Sites
          </Link>
          <Link
            to="/feed"
            className="hover:text-black transition whitespace-nowrap"
          >
            Feed
          </Link>
        </nav>
      </header>

      {/* Add top padding to account for fixed header */}
      <main className="flex-1 w-full px-4 py-6 sm:px-6 lg:px-8 pt-20">
        <div className="w-full">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
