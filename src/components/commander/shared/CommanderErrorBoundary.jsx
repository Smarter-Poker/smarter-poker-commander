/**
 * Commander Error Boundary
 * Catches render errors and displays a recovery UI
 * UI: Dark industrial sci-fi gaming theme
 */
import { Component } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

export default class CommanderErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.warn('Commander Error Boundary caught:', error, errorInfo);

    // Report to error monitoring if available
    if (typeof window !== 'undefined') {
      try {
        const { captureException } = require('../../../lib/commander/errorMonitoring');
        captureException(error, {
          action: 'render_error',
          extra: { componentStack: errorInfo?.componentStack }
        });
      } catch (e) { console.warn('[App] Handled exception:', e?.message || e); }
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  handleGoHome = () => {
    if (typeof window !== 'undefined') {
      window.location.href = '/commander/dashboard';
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="cmd-page flex items-center justify-center min-h-screen">
          <div className="cmd-panel p-8 max-w-md text-center">
            <AlertTriangle className="w-12 h-12 text-[#F59E0B] mx-auto mb-4" />
            <h2 className="text-lg font-semibold text-white mb-2">
              Something went wrong
            </h2>
            <p className="text-sm text-[#64748B] mb-6">
              {this.props.fallbackMessage || 'An error occurred while loading this page. Please try again.'}
            </p>
            <div className="flex gap-3 justify-center">
              <button
                onClick={this.handleRetry}
                className="flex items-center gap-2 px-4 py-2 cmd-btn cmd-btn-primary rounded-lg font-medium transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Retry
              </button>
              <button
                onClick={this.handleGoHome}
                className="flex items-center gap-2 px-4 py-2 border border-[#4A5E78] text-[#64748B] rounded-lg font-medium hover:bg-[#132240] transition-colors"
              >
                <Home className="w-4 h-4" />
                Dashboard
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
