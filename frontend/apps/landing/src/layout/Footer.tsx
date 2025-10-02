import BlueskyIcon from '../assets/BlueskyIcon'
import DiscordIcon from '../assets/DiscordIcon'
import GithubIcon from '../assets/GithubIcon'
import LinkedInIcon from '../assets/LinkedInIcon'
import SeedLogo from '../assets/SeedLogo'
import XIcon from '../assets/XIcon'

export default function Footer() {
  return (
    <footer className="w-full bg-white px-4 py-6 text-sm text-gray-600">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 md:flex-row">
        {/* Logo + Text + Copyright */}
        <div className="flex w-full flex-col items-start text-center text-gray-400 md:w-auto md:items-start md:text-left">
          <div className="flex w-full items-center justify-center gap-2 md:justify-start">
            <SeedLogo className="h-5 w-5" />
            <span className="text-lg font-normal">Seed Hypermedia</span>
          </div>
          <p className="mt-1 w-full text-xs md:w-auto">
            seed.hyper.media {new Date().getFullYear()} © All rights reserved
          </p>
        </div>

        {/* Socials + Terms */}
        <div className="flex flex-col items-end text-sm text-gray-400">
          <div className="mb-1 flex gap-4">
            <a
              href="https://github.com/seed-hypermedia"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-black"
            >
              <GithubIcon className="h-6 w-6" />
            </a>
            <a
              href="https://discord.gg/mcUnKENdKX"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-black"
            >
              <DiscordIcon className="h-6 w-6" />
            </a>
            <a
              href="https://linkedin.com/company/seed-hypermedia"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-black"
            >
              <LinkedInIcon className="h-6 w-6" />
            </a>
            <a
              href="https://x.com/seedhypermedia"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-black"
            >
              <XIcon className="h-6 w-6" />
            </a>
            <a
              href="https://bsky.app/profile/seed.hyper.media"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-black"
            >
              <BlueskyIcon className="h-6 w-6" />
            </a>
          </div>
          {/* <a href="/terms" className="text-xs hover:underline">
            Terms and Conditions
          </a> */}
        </div>
      </div>
    </footer>
  )
}
