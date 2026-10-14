import type { ChangeEvent, TextareaHTMLAttributes } from 'react';
import { cx } from './cx';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  /** Visible lines; 3 by default. */
  rows?: number;
  disabled?: boolean;
  id?: string;
  onChange?: (e: ChangeEvent<HTMLTextAreaElement>) => void;
}

/** A multi-line text box styled as `.form-control`. Put it in a <FormField>. */
export function Textarea({ className, rows = 3, ...rest }: TextareaProps) {
  return <textarea rows={rows} className={cx('form-control', className)} {...rest} />;
}
