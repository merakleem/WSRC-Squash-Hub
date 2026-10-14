import type { ReactNode } from 'react';

export interface FormActionsProps {
  /** The buttons: secondary (Cancel) first, the primary action last. */
  children: ReactNode;
}

/** The right-aligned button row that ends a form or a modal. */
export function FormActions({ children }: FormActionsProps) {
  return <div className="form-actions">{children}</div>;
}
