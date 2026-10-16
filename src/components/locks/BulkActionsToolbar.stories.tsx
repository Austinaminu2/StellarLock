import type { Meta, StoryObj } from "@storybook/react"
import { fn } from "@storybook/test"
import { BulkActionsToolbar } from "./BulkActionsToolbar"

const meta = {
  title: "Locks/BulkActionsToolbar",
  component: BulkActionsToolbar,
  tags: ["autodocs"],
  argTypes: {
    selectedCount: {
      control: "number",
    },
    allSelected: {
      control: "boolean",
    },
    canExtend: {
      control: "boolean",
    },
    canTransfer: {
      control: "boolean",
    },
  },
} satisfies Meta<typeof BulkActionsToolbar>

export default meta
type Story = StoryObj<typeof meta>

export const ZeroSelected: Story = {
  args: {
    selectedCount: 0,
    allSelected: false,
    onClear: fn(),
    onSelectAll: fn(),
    onBulkExtend: fn(),
    onBulkTransfer: fn(),
    canExtend: true,
    canTransfer: true,
  },
}

export const SomeSelected: Story = {
  args: {
    selectedCount: 3,
    allSelected: false,
    onClear: fn(),
    onSelectAll: fn(),
    onBulkExtend: fn(),
    onBulkTransfer: fn(),
    canExtend: true,
    canTransfer: true,
  },
}

export const AllSelected: Story = {
  args: {
    selectedCount: 10,
    allSelected: true,
    onClear: fn(),
    onSelectAll: fn(),
    onBulkExtend: fn(),
    onBulkTransfer: fn(),
    canExtend: true,
    canTransfer: true,
  },
}

export const OnlyExtendAvailable: Story = {
  args: {
    selectedCount: 5,
    allSelected: false,
    onClear: fn(),
    onSelectAll: fn(),
    onBulkExtend: fn(),
    onBulkTransfer: fn(),
    canExtend: true,
    canTransfer: false,
  },
}

export const OnlyTransferAvailable: Story = {
  args: {
    selectedCount: 2,
    allSelected: false,
    onClear: fn(),
    onSelectAll: fn(),
    onBulkExtend: fn(),
    onBulkTransfer: fn(),
    canExtend: false,
    canTransfer: true,
  },
}

export const NoActionsAvailable: Story = {
  args: {
    selectedCount: 1,
    allSelected: false,
    onClear: fn(),
    onSelectAll: fn(),
    onBulkExtend: fn(),
    onBulkTransfer: fn(),
    canExtend: false,
    canTransfer: false,
  },
}
