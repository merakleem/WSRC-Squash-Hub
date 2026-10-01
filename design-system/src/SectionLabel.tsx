import type { HTMLAttributes } from 'react';
import { cx } from './cx';

export interface SectionLabelProps extends HTMLAttributes<HTMLSpanElement> {}

/** The small uppercase Barlow heading above a block of content. */
export function SectionLabel({ className, ...rest }: SectionLabelProps) {
  return <span className={cx('section-label', className)} {...rest} />;
}
