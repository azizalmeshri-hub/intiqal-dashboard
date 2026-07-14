import React from 'react'

export default class AppErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, componentStack: '' }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    const stack = info?.componentStack || ''
    this.setState({ componentStack: stack })
    // Keep full crash diagnostics visible in devtools.
    console.error('AppErrorBoundary caught an error:', error)
    console.error('Component stack:', stack)
  }

  render() {
    if (this.state.hasError) {
      const message = this.state.error?.message || 'Unknown runtime error'
      return (
        <div className="auth-shell">
          <div className="auth-card">
            <h1 className="display" style={{ marginBottom: 8 }}>Application Error</h1>
            <p className="card-sub" style={{ marginBottom: 10 }}>
              A runtime error occurred. Please check the browser console for full details.
            </p>
            <div className="tag-note" style={{ color: 'var(--red)', background: 'var(--red-dim)' }}>
              {message}
            </div>
            {this.state.componentStack ? (
              <pre style={{ whiteSpace: 'pre-wrap', marginTop: 12, fontSize: 12, color: 'var(--steel-200)' }}>
                {this.state.componentStack}
              </pre>
            ) : null}
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
