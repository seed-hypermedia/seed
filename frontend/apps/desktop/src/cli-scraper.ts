#!/usr/bin/env node

import {nanoid} from 'nanoid'
import {scrapeUrl} from './web-scraper.js'

async function main() {
  const url = process.argv[2]
  if (!url) {
    console.error('Please provide a URL as an argument')
    console.error('Usage: ts-node cli-scraper.ts <url>')
    process.exit(1)
  }

  const scrapeId = nanoid(10)
  console.log(`Starting scrape of ${url} with ID: ${scrapeId}`)

  try {
    const result = await scrapeUrl(url, scrapeId, (status) => {
      console.log(`Status: ${status.scrapeMode}`)
      console.log(`Pages discovered: ${status.pagesDiscovered}`)
      console.log(`Pages processed: ${status.pagesProcessed}`)
    })

    console.log('\nScrape completed successfully!')
    console.log(`Found ${result.posts.length} posts`)
    console.log(`Found ${result.assets.length} assets`)
    console.log(
      `Results saved in: ${
        process.env.APPDATA || process.env.HOME
      }/.seed/importer/scrapes/${scrapeId}`,
    )
  } catch (error) {
    console.error('Scrape failed:', error)
    process.exit(1)
  }
}

main()
