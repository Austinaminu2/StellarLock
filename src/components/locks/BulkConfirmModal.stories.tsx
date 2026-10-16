import type { Meta, StoryObj } from "@storybook/react"
import { fn } from "@storybook/test"
import { BulkConfirmModal } from "./BulkConfirmModal"
import type { Lock } from "@/types/lock"
import type { ComponentProps } from "react"

type OnConfirm = ComponentProps<typeof BulkConfirmModal>["onConfirm"]

const meta = {
  title: "Locks/BulkConfirmModal",
  component: BulkConfirmModal,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof BulkConfirmModal>

export default meta
type Story = StoryObj<typeof meta>

const CREATOR = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
const BENEFICIARY = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"

const mockLocks: Lock[] = [
  {
    id: "1",
    kind: "token",
    status: "locked",
    token: {
      address: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      symbol: "USDC",
      name: "USD Coin",
      decimals: 6,
    },
    creator: CREATOR,
    beneficiary: BENEFICIARY,
    amount: 1000,
    usdValue: 1000,
    createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
    unlockAt: Date.now() + 90 * 24 * 60 * 60 * 1000,
    extendedCount: 0,
  },
  {
    id: "2",
    kind: "token",
    status: "locked",
    token: {
      address: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB",
      symbol: "SOROSWAP",
      name: "Soroswap Token",
      decimals: 7,
    },
    creator: CREATOR,
    beneficiary: BENEFICIARY,
    amount: 5000,
    usdValue: 5000,
    createdAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
    unlockAt: Date.now() + 180 * 24 * 60 * 60 * 1000,
    extendedCount: 0,
  },
  {
    id: "3",
    kind: "lp",
    status: "locked",
    token: {
      address: "CDCDCDCDCDCDCDCDCDCDCDCDCDCDCDCDCDCDCDCDCDCDCDCDCDCDCD",
      symbol: "USDC-SOROSWAP",
      name: "USDC-SOROSWAP LP",
      decimals: 8,
    },
    creator: CREATOR,
    beneficiary: BENEFICIARY,
    amount: 2500,
    usdValue: 2500,
    createdAt: Date.now() - 120 * 24 * 60 * 60 * 1000,
    unlockAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
    extendedCount: 0,
    vesting: {
      start: Date.now() - 120 * 24 * 60 * 60 * 1000,
      end: Date.now() + 365 * 24 * 60 * 60 * 1000,
      released: 0,
    },
    dex: "soroswap",
    poolPair: [
      "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB",
    ],
  },
]

export const ExtendPending: Story = {
  args: {
    action: "extend",
    locks: mockLocks,
    onConfirm: fn(() => Promise.resolve()),
    onClose: fn(),
  },
}

export const TransferPending: Story = {
  args: {
    action: "transfer",
    locks: mockLocks.slice(0, 2),
    onConfirm: fn(() => Promise.resolve()),
    onClose: fn(),
  },
}

export const ExtendSingleLock: Story = {
  args: {
    action: "extend",
    locks: mockLocks.slice(0, 1),
    onConfirm: fn(() => Promise.resolve()),
    onClose: fn(),
  },
}

export const TransferInProgress: Story = {
  args: {
    action: "transfer",
    locks: mockLocks,
    onConfirm: fn<OnConfirm>(async (_value, onItemSettled) => {
      // Simulate processing items
      await new Promise((resolve) => setTimeout(resolve, 500))
      onItemSettled("1", { status: "success" })
      await new Promise((resolve) => setTimeout(resolve, 500))
      onItemSettled("2", { status: "success" })
      await new Promise((resolve) => setTimeout(resolve, 500))
      onItemSettled("3", { status: "error", error: "Insufficient balance" })
    }),
    onClose: fn(),
  },
}

export const ExtendCompleted: Story = {
  args: {
    action: "extend",
    locks: mockLocks,
    onConfirm: fn<OnConfirm>(async (_value, onItemSettled) => {
      // Simulate all items completed
      await new Promise((resolve) => setTimeout(resolve, 300))
      onItemSettled("1", { status: "success" })
      onItemSettled("2", { status: "success" })
      onItemSettled("3", { status: "success" })
    }),
    onClose: fn(),
  },
}

export const TransferWithFailures: Story = {
  args: {
    action: "transfer",
    locks: mockLocks,
    onConfirm: fn<OnConfirm>(async (_value, onItemSettled) => {
      // Simulate mixed results
      await new Promise((resolve) => setTimeout(resolve, 300))
      onItemSettled("1", { status: "success" })
      onItemSettled("2", { status: "error", error: "Invalid address" })
      onItemSettled("3", { status: "success" })
    }),
    onClose: fn(),
  },
}
