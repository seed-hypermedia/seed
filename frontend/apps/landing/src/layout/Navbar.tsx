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
      document.body.style.overflow = 'unset'
    }

    // Cleanup function to restore scroll when component unmounts
    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [isMobileMenuOpen])

  const navLinks = [
    {href: 'https://seed.hyper.media/resources', label: 'Resources'},
    {href: 'https://seed.hyper.media/blog', label: 'Blog'},
    {href: 'https://seed.hyper.media/team', label: 'Team'},
    {href: 'https://seed.hyper.media/community', label: 'Community'},
  ]

  return (
    <header className="flex fixed top-0 right-0 left-0 z-40 justify-between items-center px-8 py-4 w-full bg-white border-b border-gray-200 shadow-sm">
      <a href="/" className="flex items-center space-x-2">
        <SeedLogo className="w-6 h-6 text-brand-5" />
        <span className="text-lg font-semibold text-transparent whitespace-nowrap bg-clip-text bg-gradient-to-r from-brand-5 to-brand-6">
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
          className="fixed inset-0 z-50 backdrop-blur-md bg-black/20 md:hidden"
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
            isMobileMenuOpen ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
          } `}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="relative p-8">
            {/* Close button */}
            <button
              onClick={closeMobileMenu}
              className="absolute top-4 right-4 p-2 text-gray-500 rounded-full transition-colors hover:bg-gray-100/50 hover:text-gray-700"
              aria-label="Close menu"
            >
              <X size={20} />
            </button>

            <div className="flex flex-col mt-4 space-y-1">
              {navLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  className="block px-4 py-4 text-xl font-bold text-gray-800 rounded-xl transition-all duration-200 hover:text-brand-5 hover:bg-gray-50/50"
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
