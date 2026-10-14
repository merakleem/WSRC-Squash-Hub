import type { ChangeEvent, InputHTMLAttributes } from 'react';
import { cx } from './cx';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** text (default), number, date, time, email, tel, password. */
  type?: 'text' | 'number' | 'date' | 'time' | 'email' | 'tel' | 'password';
  value?: string | number;
  defaultValue?: string | number;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  min?: number | string;
  max?: number | string;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
}

/** A text, number or date input (`.form-control`). Put it in a <FormField>. */
export function Input({ className, type = 'text', ...rest }: InputProps) {
  return <input type={type} className={cx('form-control', className)} {...rest} />;
}
