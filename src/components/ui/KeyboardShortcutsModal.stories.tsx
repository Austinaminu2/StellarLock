import type { Meta, StoryObj } from "@storybook/react"
import { fn } from "@storybook/test"
import { KeyboardShortcutsModal } from "./KeyboardShortcutsModal"

const meta = {
  title: "UI/KeyboardShortcutsModal",
  component: KeyboardShortcutsModal,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background">
        <Story />
      </div>
    ),
  ],
  argTypes: {
    open: { control: "boolean" },
    onClose: { action: "onClose" },
  },
} satisfies Meta<typeof KeyboardShortcutsModal>

export default meta
type Story = StoryObj<typeof meta>

export const Open: Story = {
  args: {
    open: true,
    onClose: fn(),
  },
}

export const Closed: Story = {
  args: {
    open: false,
    onClose: fn(),
  },
  render: (args) => (
    <div>
      <KeyboardShortcutsModal {...args} />
      <span className="text-sm italic text-muted-foreground">Modal is closed — nothing rendered.</span>
    </div>
  ),
}
