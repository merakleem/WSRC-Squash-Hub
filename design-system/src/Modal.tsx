import type { ReactNode } from 'react';
import { cx } from './cx';

export interface ModalProps {
  /** The heading in the modal's header bar. */
  title: ReactNode;
  /** default 480px, medium 580px, wide 920px. */
  size?: 'default' | 'medium' | 'wide';
  /** Draw the dimmed full-screen backdrop behind the panel, as the app does when a modal is open (default). Set false to place the panel inline in a layout. */
  overlay?: boolean;
  onClose?: () => void;
  /** The body. End a form with <FormActions>. */
  children: ReactNode;
}

/**
 * The app's single dialog: a white panel with a title bar and a close button,
 * over a dark backdrop. Every form, confirmation and explainer opens in it.
 */
export function Modal({ title, size = 'default', overlay = true, onClose, children }: ModalProps) {
  const panel = (
    <div className={cx('modal', size === 'medium' && 'modal-medium', size === 'wide' && 'modal-wide')}
      role="dialog" aria-modal={overlay || undefined}>
      <div className="modal-header">
        <h2 className="modal-title">{title}</h2>
        <button className="modal-close" aria-label="Close" onClick={onClose}>{'×'}</button>
      </div>
      <div className="modal-body">{children}</div>
    </div>
  );
  return overlay ? <div className="modal-overlay open">{panel}</div> : panel;
}
