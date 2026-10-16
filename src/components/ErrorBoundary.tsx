import { Component, type ErrorInfo, type ReactNode } from "react"
import { ErrorFallback } from "./ErrorFallback"
import { createLogger } from "@/lib/logger"

const log = createLogger("ErrorBoundary")

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    log.error("App error", { error, info })
  }

  render() {
    if (this.state.error) {
      return <ErrorFallback onReset={() => this.setState({ error: null })} />
    }
    return this.props.children
  }
}
