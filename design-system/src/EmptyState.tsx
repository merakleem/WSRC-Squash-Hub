import type { ReactNode } from 'react';

export interface EmptyStateProps {
  /** What is missing: "No tournaments yet". */
  title: ReactNode;
  /** One line on why, or what to do about it. */
  children?: ReactNode;
  /** An optional primary <Button> that fixes it. */
  action?: ReactNode;
}

/**
 * The centred message a page shows when it has nothing to list. The app
 * always sits it inside a <TableCard>.
 */
export function EmptyState({ title, children, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}
