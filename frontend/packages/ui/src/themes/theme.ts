import {createThemeBuilder} from '@tamagui/theme-builder'

import {masks} from './masks'
import {palettes} from './palettes'
import {shadows} from './shadows'
import {templates} from './templates'
import {darkColors, lightColors} from './token-colors'

const colorThemeDefinition = (colorName: string) => [
  {
    parent: 'light',
    palette: colorName,
    template: 'colorLight',
  },
  {
    parent: 'dark',
    palette: colorName,
    template: 'base',
  },
]

const themesBuilder = createThemeBuilder()
  .addPalettes(palettes)
  .addTemplates(templates)
  .addMasks(masks)
  .addThemes({
    light: {
      template: 'base',
      palette: 'light',
      nonInheritedValues: {
        ...lightColors,
        ...shadows.light,
      },
    },
    dark: {
      template: 'base',
      palette: 'dark',
      nonInheritedValues: {
        ...darkColors,
        ...shadows.dark,
      },
    },
  })
  .addChildThemes({
    // orange: colorThemeDefinition('orange'),
    yellow: colorThemeDefinition('yellow'),
    green: colorThemeDefinition('green'),
    blue: colorThemeDefinition('blue'),
    purple: colorThemeDefinition('purple'),
    // pink: colorThemeDefinition('pink'),
    red: colorThemeDefinition('red'),
    brand: colorThemeDefinition('brand'),
  })
// .addChildThemes({
//   alt1: {
//     mask: 'soften',
//     ...maskOptions.alt,
//   },
//   alt2: {
//     mask: 'soften2',
//     ...maskOptions.alt,
//   },
//   active: {
//     mask: 'soften3',
//     skip: {
//       color: 1,
//     },
//   },
// })
// .addChildThemes(componentThemeDefinitions, {
//   // to save bundle size but make alt themes not work on components
//   // avoidNestingWithin: ['alt1', 'alt2'],
// })

export const themes = themesBuilder.build()
