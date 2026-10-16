import type { Meta, StoryObj } from "@storybook/react"
import { fn } from "@storybook/test"
import type { Lock } from "@/types/lock"
import { LockCard } from "./LockCard"
import { BrowserRouter } from "react-router-dom"

const meta = {
  title: "Locks/LockCard",
  component: LockCard,
  tags: ["autodocs"],
  decorators: [
    (Story) => (
      <BrowserRouter>
        <div className="max-w-md">
          <Story />
        </div>
      </BrowserRouter>
    ),
  ],
} satisfies Meta<typeof LockCard>

export default meta
type Story = StoryObj<typeof meta>

const now = Date.now()
const in90Days = now + 90 * 24 * 60 * 60 * 1000
const in180Days = now + 180 * 24 * 60 * 60 * 1000
const ago30Days = now - 30 * 24 * 60 * 60 * 1000

const tokenLockLocked: Lock = {
  id: "1",
  kind: "token",
  status: "locked",
  token: {
    address: "CA7QYNF5DQX5ZOY2IEVDWQCKLGK2T4OBJCWTYADJUSTEDTOKEN",
    symbol: "USDC",
    name: "USD Coin",
    decimals: 6,
    logo: "https://example.com/usdc.png",
  },
  creator: "GBUQWP3BOUZX34ULNQG23RQ6F4V4UYXDEYK3Z77ADJUSTEDCREATOR",
  beneficiary: "GBUQWP3BOUZX34ULNQG23RQ6F4V4UYXDEYK3Z77ADJUSTEDBEN",
  amount: 10000,
  usdValue: 10000,
  createdAt: ago30Days,
  unlockAt: in90Days,
  extendedCount: 0,
}

const tokenLockUnlockable: Lock = {
  ...tokenLockLocked,
  status: "unlockable",
  createdAt: ago30Days,
  unlockAt: now - 1000, // Already unlocked
}

const tokenLockWithdrawn: Lock = {
  ...tokenLockLocked,
  status: "withdrawn",
  createdAt: ago30Days,
  unlockAt: now - 7 * 24 * 60 * 60 * 1000, // Unlocked 7 days ago
}

const lpLockLocked: Lock = {
  id: "2",
  kind: "lp",
  status: "locked",
  token: {
    address: "CDPV3LFWAXFGXNNKMQTDPYQVTHXQZ7FONAAA4ADJUSTEDPOOL",
    symbol: "SOROSWAP-LP",
    name: "Soroswap LP Token",
    decimals: 7,
  },
  dex: "soroswap",
  poolPair: ["CA7QYNF5DQX5ZOY2IEVDWQCKLGK2T4OBJCWTYADJUSTEDTOKEN", "CDPV3LFWAXFGXNNKMQTDPYQVTHXQZ7FONAAA4ADJUSTEDOTHER"],
  creator: "GBUQWP3BOUZX34ULNQG23RQ6F4V4UYXDEYK3Z77ADJUSTEDCREATOR",
  beneficiary: "GBUQWP3BOUZX34ULNQG23RQ6F4V4UYXDEYK3Z77ADJUSTEDBEN",
  amount: 500,
  usdValue: 5000,
  createdAt: ago30Days,
  unlockAt: in180Days,
  extendedCount: 0,
}

const lpLockExtended: Lock = {
  ...lpLockLocked,
  id: "3",
  status: "unlockable",
  unlockAt: now - 1000,
  extendedCount: 3,
}

export const TokenLockLocked: Story = {
  args: {
    lock: tokenLockLocked,
    selectable: false,
    selected: false,
  },
}

export const TokenLockUnlockable: Story = {
  args: {
    lock: tokenLockUnlockable,
    selectable: false,
    selected: false,
  },
}

export const TokenLockWithdrawn: Story = {
  args: {
    lock: tokenLockWithdrawn,
    selectable: false,
    selected: false,
  },
}

export const LPLockLocked: Story = {
  args: {
    lock: lpLockLocked,
    selectable: false,
    selected: false,
  },
}

export const LPLockExtended: Story = {
  args: {
    lock: lpLockExtended,
    selectable: false,
    selected: false,
  },
}

export const Selectable: Story = {
  args: {
    lock: tokenLockLocked,
    selectable: true,
    selected: false,
    onSelect: fn(),
  },
}

export const SelectableSelected: Story = {
  args: {
    lock: tokenLockLocked,
    selectable: true,
    selected: true,
    onSelect: fn(),
  },
}
