import type { Meta, StoryObj } from "@storybook/react"
import { TxErrorAlert } from "./TxErrorAlert"

const meta = {
  title: "UI/TxErrorAlert",
  component: TxErrorAlert,
  tags: ["autodocs"],
} satisfies Meta<typeof TxErrorAlert>

export default meta
type Story = StoryObj<typeof meta>

/** Wallet rejected the transaction — title, message and recovery suggestion. */
export const Default: Story = {
  args: {
    error: {
      code: "USER_REJECTED",
      i18nKey: "errors.userRejected",
      title: "errors.userRejected.title",
      message: "errors.userRejected.message",
      recovery: "errors.userRejected.recovery",
      link: null,
    },
  },
}

/** Contract error without a recovery suggestion. */
export const WithoutRecovery: Story = {
  args: {
    error: {
      code: "UNKNOWN",
      i18nKey: "errors.unknown",
      title: "errors.unknown.title",
      message: "errors.unknown.message",
      recovery: null,
      link: null,
    },
  },
}

/** Timeout error with an external link to check the transaction status. */
export const WithLink: Story = {
  args: {
    error: {
      code: "TIMEOUT",
      i18nKey: "errors.timeout",
      title: "errors.timeout.title",
      message: "errors.timeout.message",
      recovery: "errors.timeout.recovery",
      link: { label: "Check on Stellar Expert", url: "https://stellar.expert/explorer/testnet" },
    },
  },
}

/** No error — the component renders nothing. */
export const Empty: Story = {
  args: {
    error: null,
  },
}
