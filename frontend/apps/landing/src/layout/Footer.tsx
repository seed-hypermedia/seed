import DiscordIcon from "../assets/DiscordIcon";
import LinkedInIcon from "../assets/LinkedInIcon";
import SeedLogo from "../assets/SeedLogo";
import XIcon from "../assets/XIcon";

export default function Footer() {
  return (
    <footer className="w-full bg-white py-6 px-4 text-sm text-gray-600">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
        {/* Logo + Text + Copyright */}
        <div className="flex flex-col items-start md:items-start text-gray-400 text-center md:text-left w-full md:w-auto">
          <div className="flex items-center justify-center md:justify-start gap-2 w-full">
            <SeedLogo className="w-5 h-5" />
            <span className="text-lg font-normal">Seed Hypermedia</span>
          </div>
          <p className="text-xs mt-1 w-full md:w-auto">
            seed.hyper.media 2023 © All rights reserved
          </p>
        </div>

        {/* Socials + Terms */}
        <div className="flex flex-col items-end text-gray-400 text-sm">
          <div className="flex gap-4 mb-1">
            <a
              href="https://discord.gg/mcUnKENdKX"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-black"
            >
              <DiscordIcon className="w-6 h-6" />
            </a>
            <a
              href="https://linkedin.com/company/seed-hypermedia"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-black"
            >
              <LinkedInIcon className="w-6 h-6" />
            </a>
            <a
              href="https://x.com/seedhypermedia"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-black"
            >
              <XIcon className="w-6 h-6" />
            </a>
          </div>
          {/* To Do */}
          <a href="/terms" className="text-xs hover:underline">
            Terms and Conditions
          </a>
        </div>
      </div>
    </footer>
  );
}
