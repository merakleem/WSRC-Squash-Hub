import type { ChangeEvent, InputHTMLAttributes, ReactNode } from 'react';

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** The text beside the box. */
  label: ReactNode;
  checked?: boolean;
  defaultChecked?: boolean;
  disabled?: boolean;
  onChange?: (e: ChangeEvent<HTMLInputElement>) => void;
}

/** A checkbox with its label, as a form row (`.form-group-check .check-label`). */
export function Checkbox({ label, ...rest }: CheckboxProps) {
  return (
    <div className="form-group-check">
      <label className="check-label">
        <input type="checkbox" {...rest} />
        {label}
      </label>
    </div>
  );
}
