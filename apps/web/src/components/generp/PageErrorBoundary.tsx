import { Component, type ErrorInfo, type ReactNode } from 'react'

type Props = { children: ReactNode; title?: string }
type State = { error: Error | null }

/** Shows page errors instead of a blank / stuck placeholder. */
export class PageErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(this.props.title || 'Page error', error, info)
  }

  componentDidUpdate(prev: Props) {
    if (prev.children !== this.props.children && this.state.error) {
      this.setState({ error: null })
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="placeholder-page">
          <h2>Something went wrong</h2>
          <p className="error-banner">{this.state.error.message}</p>
          <button type="button" className="btn btn-primary" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
