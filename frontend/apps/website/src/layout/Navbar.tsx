import logo from "../assets/seed-logo.svg";

export default function Navbar() {
  return (
    <header className="w-full px-8 py-4 flex items-center justify-between border-b border-gray-200">
      <div className="flex items-center space-x-2">
        <img src={logo} alt="Seed logo" className="h-6 w-6" />
        <span className="text-lg font-semibold bg-gradient-to-r from-brand-5 to-brand-6 text-transparent bg-clip-text">
          Seed Hypermedia
        </span>
      </div>

      <nav className="flex space-x-6 text-sm font-medium text-gray-700">
        <a href="#resources" className="hover:text-black transition">
          Resources
        </a>
        <a href="#ecosystem" className="hover:text-black transition">
          Ecosystem
        </a>
        <a href="#blog" className="hover:text-black transition">
          Blog
        </a>
        <a href="#team" className="hover:text-black transition">
          Team
        </a>
        <a href="#community" className="hover:text-black transition">
          Community
        </a>
      </nav>
    </header>
  );
}
