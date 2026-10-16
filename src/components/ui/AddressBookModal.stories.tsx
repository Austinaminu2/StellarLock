import type { Meta, StoryObj } from "@storybook/react"
import { fn } from "@storybook/test"
import { AddressBookModal } from "./AddressBookModal"

const meta = {
  title: "UI/AddressBookModal",
  component: AddressBookModal,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div style={{ minHeight: "600px" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AddressBookModal>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    onClose: () => {},
  },
}

export const WithSelectCallback: Story = {
  args: {
    onSelect: fn(),
    onClose: () => {},
  },
}

export const EmptyState: Story = {
  args: {
    onClose: () => {},
  },
  render: (args) => {
    // Clear localStorage to show empty state
    if (typeof window !== "undefined") {
      const prev = window.localStorage.getItem("stellarlock-address-book")
      window.localStorage.removeItem("stellarlock-address-book")
      setTimeout(() => {
        if (prev) window.localStorage.setItem("stellarlock-address-book", prev)
      }, 100)
    }
    return <AddressBookModal {...args} />
  },
}
