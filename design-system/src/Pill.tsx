import type { HTMLAttributes } from 'react';
import { cx } from './cx';

export type PillColor = 'green' | 'grey' | 'blue' | 'red' | 'amber' | 'hero-green' | 'hero-grey' | 'hero-blue';

export interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  /** The hero- colours are for pills sitting on a navy surface. */
  color?: PillColor;
}

/**
 * A small statement of state - "Signed up", "Open", "Past", "Missed",
 * "Pending". Never clickable.
 */
export function Pill({ color = 'grey', className, ...rest }: PillProps) {
  return <span className={cx('pill', `pill--${color}`, className)} {...rest} />;
}
