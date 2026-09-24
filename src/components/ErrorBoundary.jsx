import { Component } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className='min-h-screen flex items-center justify-center bg-slate-50 px-6'>
          <div className='text-center max-w-md'>
            <div className='flex h-16 w-16 items-center justify-center rounded-2xl bg-rose-50 text-rose-500 mx-auto mb-5'>
              <AlertCircle className='w-8 h-8' />
            </div>
            <h2 className='text-xl font-bold text-slate-900'>Something went wrong</h2>
            <p className='text-sm text-slate-500 mt-2 mb-1'>An unexpected error occurred while rendering this page.</p>
            <pre className='text-xs text-slate-400 bg-slate-100 rounded-lg p-3 mt-3 mb-5 overflow-auto max-h-32 text-left'>{this.state.error?.message || String(this.state.error)}</pre>
            <button
              onClick={() => { this.setState({ hasError: false, error: null }); window.location.href = '/app'; }}
              className='inline-flex items-center gap-2 rounded-xl bg-slate-900 text-white px-5 py-2.5 text-sm font-semibold hover:bg-slate-800'
            >
              <RefreshCw className='w-4 h-4' /> Reload dashboard
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
