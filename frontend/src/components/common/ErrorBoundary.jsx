import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.reset = this.reset.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary:', error, info?.componentStack);
  }

  reset() {
    this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" style={{ padding: 24, color: '#ff6b6b' }}>
        <h3 style={{ margin: '0 0 8px' }}>Wystąpił błąd w tej zakładce</h3>
        <button type="button" onClick={this.reset} style={{ marginBottom: 12, cursor: 'pointer' }}>
          Spróbuj ponownie
        </button>
        <details>
          <summary style={{ cursor: 'pointer' }}>Szczegóły błędu</summary>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11 }}>
            {String(error?.message || error)}
            {error?.stack ? '\n' + error.stack : ''}
          </pre>
        </details>
      </div>
    );
  }
}

export default ErrorBoundary;
