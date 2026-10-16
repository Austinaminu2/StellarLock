import type { Meta, StoryObj } from "@storybook/react"
import { fn } from "@storybook/test"
import { ConfirmLockModal, type LockConfirmData } from "./ConfirmLockModal"

const meta = {
  title: "Locks/ConfirmLockModal",
  component: ConfirmLockModal,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <div className="min-h-screen bg-background">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ConfirmLockModal>

export default meta
type Story = StoryObj<typeof meta>

const tokenLockData: LockConfirmData = {
  tokenAddress: "CA7QYNF5DQX5ZOY2IEVDWQCKLGK2T4OBJCWTYBadjustedfortoken",
  amount: "1000",
  beneficiary: "GBUQWP3BOUZX34ULNQG23RQ6F4V4UYXDEYK3Z77ADJUSTEDFORBEN",
  unlockDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
  vesting: false,
  balance: 5000,
  allowance: 1000,
  needsApproval: false,
  isLp: false,
}

const lpLockData: LockConfirmData = {
  poolShareAddress: "CDPV3LFWAXFGXNNKMQTDPYQVTHXQZ7FONAAA4ADJUSTEDFORPOOL",
  amount: "500",
  beneficiary: "GBUQWP3BOUZX34ULNQG23RQ6F4V4UYXDEYK3Z77ADJUSTEDFORBEN",
  unlockDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
  vesting: true,
  balance: 2000,
  allowance: 500,
  needsApproval: false,
  isLp: true,
  dex: "soroswap",
  tokenAddress: "",
}

export const TokenLock: Story = {
  args: {
    data: tokenLockData,
    onConfirm: fn(),
    onCancel: fn(),
    loading: false,
    approving: false,
  },
}

export const TokenLockWithApprovalNeeded: Story = {
  args: {
    data: {
      ...tokenLockData,
      needsApproval: true,
      allowance: 0,
    },
    onConfirm: fn(),
    onApprove: fn(),
    onCancel: fn(),
    loading: false,
    approving: false,
  },
}

export const TokenLockWithInsufficientBalance: Story = {
  args: {
    data: {
      ...tokenLockData,
      balance: 500,
    },
    onConfirm: fn(),
    onCancel: fn(),
    loading: false,
    approving: false,
  },
}

export const LPLock: Story = {
  args: {
    data: lpLockData,
    onConfirm: fn(),
    onCancel: fn(),
    loading: false,
    approving: false,
  },
}

export const Approving: Story = {
  args: {
    data: {
      ...tokenLockData,
      needsApproval: true,
      allowance: 0,
    },
    onConfirm: fn(),
    onApprove: fn(),
    onCancel: fn(),
    loading: false,
    approving: true,
  },
}

export const Confirming: Story = {
  args: {
    data: tokenLockData,
    onConfirm: fn(),
    onCancel: fn(),
    loading: true,
    approving: false,
  },
}
