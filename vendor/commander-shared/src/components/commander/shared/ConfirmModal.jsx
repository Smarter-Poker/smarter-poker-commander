/**
 * ConfirmModal - Shared confirmation dialog for Commander pages.
 * Replaces browser confirm() with a non-blocking inline modal.
 * 
 * Usage with useConfirmAction hook:
 *   const { confirmState, requestConfirm, ConfirmDialog } = useConfirmAction();
 *   
 *   // Instead of: if (!confirm('Delete?')) return; doDelete();
 *   // Do:         requestConfirm('Delete?', doDelete);
 *   
 *   // In JSX:     <ConfirmDialog />
 */
import { useState, useCallback, useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * Hook: useConfirmAction
 * Returns { requestConfirm, ConfirmDialog }
 *   requestConfirm(message, onConfirm, options?)
 *   <ConfirmDialog /> - renders the modal when active
 */
export function useConfirmAction() {
  const [state, setState] = useState(null); // { message, onConfirm, confirmLabel, cancelLabel, variant }

  const requestConfirm = useCallback((message, onConfirm, options = {}) => {
    setState({
      message,
      onConfirm,
      confirmLabel: options.confirmLabel || 'Confirm',
      cancelLabel: options.cancelLabel || 'Cancel',
      variant: options.variant || 'danger', // 'danger' | 'warning' | 'info'
    });
  }, []);

  const handleConfirm = useCallback(async () => {
    if (state?.onConfirm) {
      await state.onConfirm();
    }
    setState(null);
  }, [state]);

  const handleCancel = useCallback(() => {
    setState(null);
  }, []);

  // Auto-cancel after 10 seconds
  useEffect(() => {
    if (!state) return;
    const t = setTimeout(() => setState(null), 10000);
    return () => clearTimeout(t);
  }, [state]);

  const ConfirmDialog = useCallback(() => {
    if (!state) return null;

    const colors = {
      danger: { bg: '#EF4444', border: '#EF444444', text: '#EF4444' },
      warning: { bg: '#F59E0B', border: '#F59E0B44', text: '#F59E0B' },
      info: { bg: '#1877F2', border: '#1877F244', text: '#1877F2' },
    };
    const c = colors[state.variant] || colors.danger;

    return (
      <div style={{
        position: 'fixed', inset: 0, zIndex: 99999,
        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
      }} onClick={handleCancel}>
        <div style={{
          background: '#242526', borderRadius: 16,
          border: `1px solid ${c.border}`,
          maxWidth: 400, width: '100%',
          padding: 24,
          boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
          animation: 'fadeIn 0.15s ease',
        }} onClick={e => e.stopPropagation()}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 20 }}>
            <AlertTriangle size={20} color={c.text} style={{ flexShrink: 0, marginTop: 2 }} />
            <p style={{ color: '#E4E6EB', fontSize: 14, lineHeight: 1.5, margin: 0 }}>
              {state.message}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={handleCancel}
              style={{
                flex: 1, height: 42, borderRadius: 10,
                background: '#3A3B3C', border: 'none', color: '#E4E6EB',
                fontSize: 14, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {state.cancelLabel}
            </button>
            <button
              onClick={handleConfirm}
              style={{
                flex: 1, height: 42, borderRadius: 10,
                background: c.bg, border: 'none', color: '#fff',
                fontSize: 14, fontWeight: 600, cursor: 'pointer',
              }}
            >
              {state.confirmLabel}
            </button>
          </div>
        </div>
      </div>
    );
  }, [state, handleConfirm, handleCancel]);

  return { requestConfirm, ConfirmDialog };
}

export default ConfirmModal;
function ConfirmModal() { return null; } // Default export for compatibility
