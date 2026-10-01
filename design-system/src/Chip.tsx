import type { HTMLAttributes } from 'react';
import { cx } from './cx';

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  /** hero is the chip on a navy surface. */
  type?: 'league' | 'tournament' | 'members' | 'hero';
}

/** A tiny uppercase category tag: what kind of thing this is. */
export function Chip({ type = 'league', className, ...rest }: ChipProps) {
  return <span className={cx('chip', `chip--${type}`, className)} {...rest} />;
}
