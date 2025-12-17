import {Menu, X} from 'lucide-react'
import {useEffect, useState} from 'react'
import SeedLogo from '../assets/SeedLogo'

export default function Navbar() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen)
  }

  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false)
  }

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = 'auto'
    }

    // Cleanup function to restore scroll when component unmounts
    return () => {
      document.body.style.overflow = 'auto'
    }
  }, [isMobileMenuOpen])

  const navLinks = [
    {href: 'https://seed.hyper.media/resources', label: 'Resources'},
    {href: 'https://seed.hyper.media/blog', label: 'Blog'},
    {href: 'https://seed.hyper.media/team', label: 'Team'},
    {href: 'https://seed.hyper.media/community', label: 'Support'},
    {href: 'https://seedteamtalks.hyper.media/', label: 'Development'},
  ]

  return (
    <header className="fixed top-0 right-0 left-0 z-40 flex w-full items-center justify-between border-b border-gray-200 bg-white px-8 py-4 shadow-sm">
      <a href="/" className="flex items-center space-x-2">
        <SeedLogo className="text-brand-5 h-6 w-6" />
        <span className="from-brand-5 to-brand-6 bg-gradient-to-r bg-clip-text text-lg font-semibold whitespace-nowrap text-transparent">
          Seed Hypermedia
        </span>
      </a>

      {/* Desktop nav links */}
      <nav className="hidden space-x-6 text-sm font-medium text-gray-700 md:flex">
        {navLinks.map((link) => (
          <a
            key={link.label}
            href={link.href}
            className="transition hover:text-black"
          >
            {link.label}
          </a>
        ))}
      </nav>

      {/* Mobile menu button */}
      <button
        className="relative z-50 text-gray-700 transition hover:text-black md:hidden"
        onClick={toggleMobileMenu}
        aria-label="Toggle mobile menu"
      >
        {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
      </button>

      {/* Mobile menu overlay */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/20 backdrop-blur-md md:hidden"
          onClick={closeMobileMenu}
        />
      )}

      {/* Mobile menu */}
      <nav
        className={`fixed inset-0 z-50 flex items-center justify-center md:hidden ${
          isMobileMenuOpen ? 'pointer-events-auto' : 'pointer-events-none'
        } `}
        onClick={closeMobileMenu}
      >
        <div
          className={`mx-4 w-full max-w-sm transform rounded-2xl border border-gray-100/50 bg-white/95 shadow-2xl backdrop-blur-xl transition-all duration-300 ease-out ${
            isMobileMenuOpen ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
          } `}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="relative p-8">
            {/* Close button */}
            <button
              onClick={closeMobileMenu}
              className="absolute top-4 right-4 rounded-full p-2 text-gray-500 transition-colors hover:bg-gray-100/50 hover:text-gray-700"
              aria-label="Close menu"
            >
              <X size={20} />
            </button>

            <div className="mt-4 flex flex-col space-y-1">
              {navLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  className="hover:text-brand-5 block rounded-xl px-4 py-4 text-xl font-bold text-gray-800 transition-all duration-200 hover:bg-gray-50/50"
                  onClick={closeMobileMenu}
                >
                  {link.label}
                </a>
              ))}
            </div>
          </div>
        </div>
      </nav>
    </header>
  )
}
