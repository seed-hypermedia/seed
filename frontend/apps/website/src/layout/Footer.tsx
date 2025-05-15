import {Linkedin, MessageCircle, Twitter} from "lucide-react";

export default function Footer() {
  return (
    <footer className="w-full border-t bg-white py-6 px-4 text-sm text-gray-600">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Left: Logo or text */}
        <div className="font-semibold text-gray-800">Seed Hypermedia</div>

        {/* Center: Copyright */}
        <div className="text-center text-gray-500">
          © {new Date().getFullYear()} Seed. All rights reserved.
        </div>

        {/* Right: Socials */}
        <div className="flex items-center gap-4">
          <a
            href="https://discord.gg/your-discord"
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-600 hover:text-brand-6"
          >
            <MessageCircle size={20} />
          </a>
          <a
            href="https://linkedin.com/company/your-linkedin"
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-600 hover:text-brand-6"
          >
            <Linkedin size={20} />
          </a>
          <a
            href="https://twitter.com/your-twitter"
            target="_blank"
            rel="noopener noreferrer"
            className="text-gray-600 hover:text-brand-6"
          >
            <Twitter size={20} />
          </a>
        </div>
      </div>
    </footer>
  );
}
