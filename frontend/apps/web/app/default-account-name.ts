export function createDefaultAccountName() {
  const noun = getRandomItem(seedNouns)
  const adjective = getRandomItem(seedAdjectives)
  return `${adjective} ${noun}`
}

const seedNouns = [
  'Tree',
  'Sprout',
  'Leaf',
  'Root',
  'Branch',
  'Flower',
  'Fruit',
  'Flower',
  'Stem',
  'Seedling',
  'Grass',
  'Plant',
  'Fiber',
  'Earth',
]

const seedAdjectives = [
  'Fresh',
  'Iconic',
  'Optimistic',
  'Vibrant',
  'Resilient',
  'Ethereal',
  'Radiant',
  'Radical',
  'Spontaneous',
  'Dynamic',
  'Energetic',
  'Legendary',
  'Mythical',
  'Epic',
  'Rare',
  'Unique',
  'Creative',
  'Innovative',
  'Visionary',
  'Futuristic',
  'Revolutionary',
  'Iconic',
  'Dedicated',
  'Passionate',
  'Determined',
  'Persistent',
  'Courageous',
  'Bold',
  'Brave',
  'Adventurous',
  'Curious',
  'Witty',
  'Sassy',
  'Charming',
  'Enchanting',
  'Whimsical',
  'Playful',
  'Funky',
  'Cool',
  'Chic',
  'Stylish',
  'Trendy',
  'Overwhelming',
  'Glamorous',
  'Elegant',
  'Graceful',
  'Sleek',
  'Sophisticated',
  'Glorious',
  'Majestic',
]

function getRandomItem(array: string[]): string {
  return array[Math.floor(Math.random() * array.length)]
}
