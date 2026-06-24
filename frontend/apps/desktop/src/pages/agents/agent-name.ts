// Cute default agent names like "Blue Workhorse" — a random adjective + noun
// so each new agent gets a friendly, distinct placeholder the user can keep or edit.

const ADJECTIVES = [
  'Blue',
  'Crimson',
  'Golden',
  'Silver',
  'Jade',
  'Amber',
  'Violet',
  'Scarlet',
  'Cobalt',
  'Copper',
  'Emerald',
  'Ivory',
  'Onyx',
  'Coral',
  'Azure',
  'Indigo',
  'Hazel',
  'Slate',
  'Bronze',
  'Teal',
  'Swift',
  'Clever',
  'Brave',
  'Gentle',
  'Nimble',
  'Mellow',
  'Lucky',
  'Quiet',
  'Bright',
  'Bold',
]

const NOUNS = [
  'Workhorse',
  'Falcon',
  'Otter',
  'Badger',
  'Lynx',
  'Heron',
  'Fox',
  'Marmot',
  'Beaver',
  'Mantis',
  'Sparrow',
  'Bison',
  'Ferret',
  'Wolf',
  'Raven',
  'Owl',
  'Hare',
  'Stoat',
  'Crane',
  'Newt',
  'Wren',
  'Finch',
  'Lark',
  'Mole',
  'Vole',
  'Herald',
  'Scribe',
  'Pilot',
  'Ranger',
  'Scout',
]

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

/** Generates a friendly two-word agent name like "Blue Workhorse". */
export function generateAgentName(): string {
  return `${pick(ADJECTIVES)} ${pick(NOUNS)}`
}
