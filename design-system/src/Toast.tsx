import type { ReactNode } from 'react';
import { cx } from './cx';

export interface ToastProps {
  /** default is near-black; success green; error red; warning amber. */
  type?: 'default' | 'success' | 'error' | 'warning';
  /** Pin it to the bottom-right corner of the screen, where the app shows toasts. Leave false to place it inline. */
  floating?: boolean;
  /** One short sentence: "Score saved.", "Could not load that match." */
  children: ReactNode;
}

/** The brief confirmation or error message that follows an action. */
export function Toast({ type = 'default', floating, children }: ToastProps) {
  const toast = (
    <div className={cx('toast', 'show', type !== 'default' && type)} role={type === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
  return floating ? <div className="toast-container">{toast}</div> : toast;
}
