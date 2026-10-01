import type { ChangeEvent, SelectHTMLAttributes } from 'react';
import { cx } from './cx';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Shorthand for the options; pass <option> children instead for full control. */
  options?: Array<string | { value: string; label: string }>;
  value?: string;
  defaultValue?: string;
  disabled?: boolean;
  id?: string;
  onChange?: (e: ChangeEvent<HTMLSelectElement>) => void;
}

/** A native select styled as `.form-control`. Put it in a <FormField>. */
export function Select({ className, options, children, ...rest }: SelectProps) {
  return (
    <select className={cx('form-control', className)} {...rest}>
      {options
        ? options.map((o) => (typeof o === 'string'
          ? <option key={o} value={o}>{o}</option>
          : <option key={o.value} value={o.value}>{o.label}</option>))
        : children}
    </select>
  );
}
