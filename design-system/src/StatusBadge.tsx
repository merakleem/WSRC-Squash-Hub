import type { HTMLAttributes } from 'react';
import { cx } from './cx';

export interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /** active: green, running now. completed: grey, finished. */
  status?: 'active' | 'completed';
}

/**
 * The rounded status badge in a league or tournament card's header -
 * "Active", "Group Stage", "Knockout", "Completed".
 */
export function StatusBadge({ status = 'active', className, ...rest }: StatusBadgeProps) {
  return <span className={cx('badge', `badge-${status}`, className)} {...rest} />;
}
