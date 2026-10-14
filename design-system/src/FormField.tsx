import type { ReactNode } from 'react';

export interface FormFieldProps {
  /** The label above the control. */
  label: ReactNode;
  /** A quiet note after the label, e.g. "(optional)". */
  hint?: ReactNode;
  /** A red message under the control. */
  error?: ReactNode;
  /** The id of the control, so the label focuses it. */
  htmlFor?: string;
  /** The control: an <Input>, <Select> or <Textarea>. */
  children: ReactNode;
}

/** A labelled form control: `.form-group` with its label, control and error. */
export function FormField({ label, hint, error, htmlFor, children }: FormFieldProps) {
  return (
    <div className="form-group">
      <label htmlFor={htmlFor}>{label}{hint ? <span className="form-hint">{hint}</span> : null}</label>
      {children}
      {error ? <div className="form-error">{error}</div> : null}
    </div>
  );
}
