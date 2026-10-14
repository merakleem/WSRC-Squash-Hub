import type { ChangeEvent, InputHTMLAttributes } from 'react';
import { cx } from './cx';

export interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  value?: string;
  /** Defaults to "Search players". */
  placeholder?: string;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
}

/** The compact search box that sits in a table toolbar (`.search-input`, 220px). */
export function SearchInput({ className, placeholder = 'Search players', ...rest }: SearchInputProps) {
  return <input type="search" className={cx('search-input', className)} placeholder={placeholder} {...rest} />;
}
