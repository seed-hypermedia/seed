import {Menu, X} from "lucide-react";
import {useEffect, useState} from "react";
import SeedLogo from "../assets/SeedLogo";

export default function Navbar() {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const toggleMobileMenu = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  const closeMobileMenu = () => {
    setIsMobileMenuOpen(false);
  };

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "unset";
    }

    // Cleanup function to restore scroll when component unmounts
    return () => {
      document.body.style.overflow = "unset";
    };
  }, [isMobileMenuOpen]);

  const navLinks = [
    {href: "https://seed.hyper.media/resources", label: "Resources"},
    {href: "https://seed.hyper.media/documentation", label: "Ecosystem"},
    {href: "https://seed.hyper.media/blog", label: "Blog"},
    {href: "https://seed.hyper.media/team", label: "Team"},
    {href: "https://seed.hyper.media/community", label: "Community"},
    {href: "https://explore.hyper.media/", label: "Explore"},
  ];

  return (
    <header className="fixed top-0 left-0 right-0 w-full px-8 py-4 flex items-center justify-between border-b border-gray-200 bg-white z-40 shadow-sm">
      <a href="/" className="flex items-center space-x-2">
        <SeedLogo className="w-6 h-6 text-brand-5" />
        <span className="text-lg font-semibold bg-gradient-to-r from-brand-5 to-brand-6 text-transparent bg-clip-text whitespace-nowrap">
          Seed Hypermedia
        </span>
      </a>

      {/* Desktop nav links */}
      <nav className="hidden md:flex space-x-6 text-sm font-medium text-gray-700">
        {navLinks.map((link) => (
          <a
            key={link.label}
            href={link.href}
            className="hover:text-black transition"
          >
            {link.label}
          </a>
        ))}
      </nav>

      {/* Mobile menu button */}
      <button
        className="md:hidden text-gray-700 hover:text-black transition z-50 relative"
        onClick={toggleMobileMenu}
        aria-label="Toggle mobile menu"
      >
        {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
      </button>

      {/* Mobile menu overlay */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/20 backdrop-blur-md z-50 md:hidden"
          onClick={closeMobileMenu}
        />
      )}

      {/* Mobile menu */}
      <nav
        className={`
        fixed inset-0 z-50 flex items-center justify-center md:hidden
        ${isMobileMenuOpen ? "pointer-events-auto" : "pointer-events-none"}
      `}
        onClick={closeMobileMenu}
      >
        <div
          className={`
            w-full max-w-sm mx-4 bg-white/95 backdrop-blur-xl rounded-2xl shadow-2xl border border-gray-100/50
            transform transition-all duration-300 ease-out
            ${isMobileMenuOpen ? "scale-100 opacity-100" : "scale-95 opacity-0"}
          `}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="p-8 relative">
            {/* Close button */}
            <button
              onClick={closeMobileMenu}
              className="absolute top-4 right-4 p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100/50 rounded-full transition-colors"
              aria-label="Close menu"
            >
              <X size={20} />
            </button>

            <div className="flex flex-col space-y-1 mt-4">
              {navLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  className="block py-4 px-4 text-xl font-bold text-gray-800 hover:text-brand-5 hover:bg-gray-50/50 rounded-xl transition-all duration-200"
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
  );
}
