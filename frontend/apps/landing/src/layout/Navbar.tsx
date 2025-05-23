import {Menu} from "lucide-react";
import SeedLogo from "../assets/SeedLogo";

export default function Navbar() {
  return (
    <header className="w-full px-8 py-4 flex items-center justify-between border-b border-gray-200">
      <a href="/" className="flex items-center space-x-2">
        <SeedLogo className="w-6 h-6 text-brand-5" />
        <span className="text-lg font-semibold bg-gradient-to-r from-brand-5 to-brand-6 text-transparent bg-clip-text whitespace-nowrap">
          Seed Hypermedia
        </span>
      </a>

      {/* Nav links */}
      <nav className="hidden md:flex space-x-6 text-sm font-medium text-gray-700">
        <a
          href="https://seed.hyper.media/resources"
          className="hover:text-black transition"
        >
          Resources
        </a>
        <a
          href="https://seed.hyper.media/documentation"
          className="hover:text-black transition"
        >
          Ecosystem
        </a>
        <a
          href="https://seed.hyper.media/blog"
          className="hover:text-black transition"
        >
          Blog
        </a>
        <a
          href="https://seed.hyper.media/team"
          className="hover:text-black transition"
        >
          Team
        </a>
        <a
          href="https://seed.hyper.media/community"
          className="hover:text-black transition"
        >
          Community
        </a>
      </nav>

      {/* Mobile menu icon
      To Do: add menu with nav items */}
      <button className="md:hidden text-gray-700">
        <Menu size={24} />
      </button>
    </header>
  );
}
