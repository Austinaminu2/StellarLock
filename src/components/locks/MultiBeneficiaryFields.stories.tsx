import type { Meta, StoryObj } from "@storybook/react"
import { fn } from "@storybook/test"
import type { SplitBeneficiary } from "@/lib/split-lock"
import { MultiBeneficiaryFields } from "./MultiBeneficiaryFields"

const meta = {
  title: "Locks/MultiBeneficiaryFields",
  component: MultiBeneficiaryFields,
  tags: ["autodocs"],
} satisfies Meta<typeof MultiBeneficiaryFields>

export default meta
type Story = StoryObj<typeof meta>

const validAddresses = [
  "GBUQWP3BOUZX34ULNQG23RQ6F4V4UYXDEYK3Z77ADJUSTEDBEN1",
  "GBUQWP3BOUZX34ULNQG23RQ6F4V4UYXDEYK3Z77ADJUSTEDBEN2",
  "GBUQWP3BOUZX34ULNQG23RQ6F4V4UYXDEYK3Z77ADJUSTEDBEN3",
]

const twoBeneficiaries: SplitBeneficiary[] = [
  { address: validAddresses[0], shareBps: 5000 },
  { address: validAddresses[1], shareBps: 5000 },
]

const maxBeneficiaries: SplitBeneficiary[] = Array.from({ length: 10 }).map((_, i) => ({
  address: validAddresses[i % validAddresses.length],
  shareBps: 1000,
}))

const invalidBasisPointsSum: SplitBeneficiary[] = [
  { address: validAddresses[0], shareBps: 3500 },
  { address: validAddresses[1], shareBps: 4000 },
]

export const TwoBeneficiaries: Story = {
  args: {
    beneficiaries: twoBeneficiaries,
    onChange: fn(),
  },
}

export const MaxBeneficiaries: Story = {
  args: {
    beneficiaries: maxBeneficiaries,
    onChange: fn(),
  },
}

export const InvalidBasisPointsSum: Story = {
  args: {
    beneficiaries: invalidBasisPointsSum,
    onChange: fn(),
  },
}

export const EqualSplit: Story = {
  args: {
    beneficiaries: [
      { address: validAddresses[0], shareBps: 3333 },
      { address: validAddresses[1], shareBps: 3333 },
      { address: validAddresses[2], shareBps: 3334 },
    ],
    onChange: fn(),
  },
}
