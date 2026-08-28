import React, { forwardRef, useEffect, useId, useRef } from 'react';

const cx = (...parts) => parts.filter(Boolean).join(' ');

export const ClubButtonsSurface = forwardRef(function ClubButtonsSurface(
  { as: Element = 'div', mode = 'commander', className, children, ...props },
  ref
) {
  return (
    <Element ref={ref} className={cx('cb-surface', `cb-mode-${mode}`, className)} {...props}>
      {children}
    </Element>
  );
});

export const ClubButton = forwardRef(function ClubButton(
  {
    as: Element = 'button',
    variant = 'primary',
    compact = false,
    selected = false,
    loading = false,
    leading,
    trailing,
    className,
    children,
    disabled,
    type,
    ...props
  },
  ref
) {
  const buttonProps = Element === 'button' ? { type: type || 'button', disabled: disabled || loading } : {};
  return (
    <Element
      ref={ref}
      className={cx('cb-control', `cb-${variant}`, compact && 'cb-compact', selected && 'is-selected', className)}
      aria-busy={loading || undefined}
      aria-pressed={selected || undefined}
      {...buttonProps}
      {...props}
    >
      {leading ? <span className="cb-control-leading" aria-hidden="true">{leading}</span> : null}
      <span className="cb-control-label">{loading ? 'Loading' : children}</span>
      {loading ? <span className="cb-spinner" aria-hidden="true" /> : trailing ? <span className="cb-control-trailing" aria-hidden="true">{trailing}</span> : null}
    </Element>
  );
});

export const ClubIconButton = forwardRef(function ClubIconButton(
  { label, selected = false, loading = false, badge, className, children, disabled, type = 'button', ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx('cb-icon-control', selected && 'is-selected', className)}
      aria-label={label}
      aria-pressed={selected || undefined}
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      {...props}
    >
      <span className="cb-icon-control-content" aria-hidden="true">{loading ? <span className="cb-spinner" /> : children}</span>
      {badge ? <span className="cb-control-badge" aria-hidden="true">{badge}</span> : null}
    </button>
  );
});

export const ClubNavItem = forwardRef(function ClubNavItem(
  { as: Element = 'button', active = false, icon, className, children, type, ...props },
  ref
) {
  const buttonProps = Element === 'button' ? { type: type || 'button' } : {};
  return (
    <Element
      ref={ref}
      className={cx('cb-nav-item', active && 'is-active', className)}
      aria-current={active ? 'page' : undefined}
      {...buttonProps}
      {...props}
    >
      {icon ? <span className="cb-nav-icon" aria-hidden="true">{icon}</span> : null}
      <span className="cb-nav-label">{children}</span>
    </Element>
  );
});

export function ClubValueDisplay({ label, value, state = 'loaded', className }) {
  const visibleValue = state === 'loaded' || state === 'updating' ? value : null;
  const stateText = {
    loading: 'Loading', empty: 'No Data', error: 'Unavailable', stale: 'Stale', offline: 'Offline', updating: 'Updating',
  }[state];
  return (
    <section className={cx('cb-value-display', `is-${state}`, className)} aria-busy={state === 'loading' || undefined}>
      <span className="cb-value-label">{label}</span>
      <strong className="cb-value-number" aria-live="polite">{visibleValue ?? stateText ?? 'Unavailable'}</strong>
    </section>
  );
}

export function ClubWalletRow({ icon, label, value, state = 'loaded', action = true, className, ...props }) {
  const Element = action ? 'button' : 'div';
  const interactiveProps = action ? { type: 'button', ...props } : props;
  const visibleValue = state === 'loaded' || state === 'updating' ? value : null;
  return (
    <Element className={cx('cb-wallet-row', `is-${state}`, className)} aria-busy={state === 'loading' || undefined} {...interactiveProps}>
      <span className="cb-wallet-icon" aria-hidden="true">{icon}</span>
      <span className="cb-wallet-label">{label}</span>
      <strong className="cb-wallet-value">{visibleValue ?? (state === 'loading' ? 'Loading' : 'Unavailable')}</strong>
      {action ? <span className="cb-wallet-chevron" aria-hidden="true">›</span> : null}
    </Element>
  );
}

export function ClubStatusBadge({ tone = 'info', children, className }) {
  return <span className={cx('cb-status', `cb-status-${tone}`, className)}>{children}</span>;
}

export function ClubPanel({ as: Element = 'section', title, actions, className, children, ...props }) {
  return (
    <Element className={cx('cb-panel', className)} {...props}>
      {title || actions ? (
        <header className="cb-panel-header">
          {title ? <h2 className="cb-panel-title">{title}</h2> : <span />}
          {actions}
        </header>
      ) : null}
      <div className="cb-panel-content">{children}</div>
    </Element>
  );
}

export function ClubModalFrame({ open, title, onClose, children, actions, className }) {
  const titleId = useId();
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const dialog = dialogRef.current;
    const previous = document.activeElement;
    const focusable = () => Array.from(dialog?.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') || []);
    focusable()[0]?.focus();
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previous?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="cb-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose?.()}>
      <section ref={dialogRef} className={cx('cb-modal', className)} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="cb-modal-header">
          <h2 id={titleId}>{title}</h2>
          <ClubIconButton label="Close" className="cb-modal-close" onClick={onClose}>×</ClubIconButton>
        </header>
        <div className="cb-modal-content">{children}</div>
        {actions ? <footer className="cb-modal-actions">{actions}</footer> : null}
      </section>
    </div>
  );
}

