import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from 'react';
import { cx } from './cx';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'danger-outline' | 'success' | 'ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = navy, the one main action on a screen; secondary = white with a border, everything beside it; danger = solid red, confirming a destructive action; danger-outline = red on white, the door to one; success = green; ghost = borderless text. */
  variant?: ButtonVariant;
  /** sm for dense rows and toolbars, lg for forms and sheets. */
  size?: 'sm' | 'md' | 'lg';
  /** Full width. */
  block?: boolean;
  /** An <Icon> drawn before the label; the button sizes it. */
  icon?: ReactNode;
  /** Greys the button out and ignores clicks. */
  disabled?: boolean;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  /** Defaults to "button"; use "submit" inside a <form>. */
  type?: 'button' | 'submit' | 'reset';
}

/**
 * The app's button: `.btn` plus exactly one variant, and an optional size.
 * One primary per screen; everything beside it is secondary.
 */
export function Button({ variant = 'secondary', size = 'md', block, icon, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type}
      className={cx('btn', `btn-${variant}`, size !== 'md' && `btn-${size}`, block && 'btn-block', className)}
      {...rest}>
      {icon}{children}
    </button>
  );
}
