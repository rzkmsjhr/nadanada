import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          height: '100vh', width: '100vw', backgroundColor: 'var(--bg-color, #1e1e1e)', color: 'var(--text-color, #fff)',
          padding: '20px', textAlign: 'center'
        }}>
          <AlertTriangle size={48} style={{ color: '#ef4444', marginBottom: '16px' }} />
          <h2 style={{ marginBottom: '8px' }}>Something went wrong</h2>
          <p style={{ color: 'var(--text-muted, #aaa)', marginBottom: '24px', maxWidth: '80%', wordBreak: 'break-word' }}>
            {this.state.error?.toString()}
          </p>
          <button 
            onClick={() => window.location.reload()}
            style={{
                display: 'flex', alignItems: 'center', gap: '8px',
                padding: '12px 24px', fontSize: '1rem',
                backgroundColor: 'var(--accent-color, #3b82f6)', color: '#fff',
                border: 'none', borderRadius: '8px', cursor: 'pointer'
            }}
          >
            <RotateCcw size={16} />
            Reload App
          </button>
        </div>
      );
    }

    return this.props.children; 
  }
}

export default ErrorBoundary;
