import {Link, Outlet} from 'react-router-dom'
import HMLogo from '../assets/HMLogo.svg'

export default function Layout() {
  return (
    <div className="flex min-h-screen w-screen flex-col bg-gray-100">
      <header className="fixed top-0 right-0 left-0 z-40 flex w-full items-center justify-between border-b border-gray-200 bg-white px-4 py-4 shadow-sm sm:px-8">
        <Link to="/" className="flex items-center space-x-2">
          <img src={HMLogo} alt="HM Logo" className="h-5 w-5 sm:h-6 sm:w-6" />
          <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-base font-semibold whitespace-nowrap text-transparent sm:text-lg">
            Hypermedia Explorer
          </span>
        </Link>

        <nav className="flex space-x-6 text-sm font-medium text-gray-700">
          <Link
            to="/list"
            className="whitespace-nowrap transition hover:text-black"
          >
            All Sites
          </Link>
          <Link
            to="/feed"
            className="whitespace-nowrap transition hover:text-black"
          >
            Feed
          </Link>
        </nav>
      </header>

      {/* Add top padding to account for fixed header */}
      <main className="w-full flex-1 px-4 py-6 pt-20 sm:px-6 lg:px-8">
        <div className="w-full">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
