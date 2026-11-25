import type {Meta, StoryObj} from '@storybook/react'
import {Globe, Image, Navigation} from 'lucide-react'
import {useState} from 'react'
import {SettingsToggle, SpaceSettingsNav} from './space-settings'

const meta = {
  title: 'Components/SpaceSettings',
  component: SettingsToggle,
  tags: ['autodocs'],
  args: {
    id: 'show-activity',
    label: 'Show activity',
    hint: 'Readers see recent comments and changes beside each document.',
    checked: true,
    disabled: false,
    onCheckedChange: () => {},
  },
} satisfies Meta<typeof SettingsToggle>
export default meta
type Story = StoryObj<typeof meta>
export const Toggle: Story = {
  render: function Toggle(args) {
    const [checked, setChecked] = useState(args.checked)
    return <SettingsToggle {...args} checked={checked} onCheckedChange={setChecked} />
  },
}
export const DisabledToggle: Story = {args: {disabled: true, checked: false}}
const tabs = [
  {key: 'general', icon: Globe, label: 'General'},
  {key: 'identity', icon: Image, label: 'Identity'},
  {key: 'navigation', icon: Navigation, label: 'Navigation'},
] as const
export const Nav: Story = {
  render: function Nav() {
    const [tab, setTab] = useState<(typeof tabs)[number]['key']>('general')
    return <SpaceSettingsNav tabs={tabs} activeTab={tab} onSelect={setTab} className="w-60" />
  },
}
