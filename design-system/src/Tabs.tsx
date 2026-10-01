import type { ReactNode } from 'react';
import { cx } from './cx';

export interface TabItem {
  id: string;
  label: ReactNode;
}

export interface TabsProps {
  /** The tabs, in order. A plain string is both its id and its label. */
  tabs: Array<TabItem | string>;
  /** The id of the tab that is on. */
  active: string;
  onChange?: (id: string) => void;
  /** segmented = the app's shared tab rail, the active tab filled navy (default); underline = the tournament page's text tabs over a rule, the active one underlined. */
  variant?: 'segmented' | 'underline';
  className?: string;
}

/** A row of tabs with exactly one on. */
export function Tabs({ tabs, active, onChange, variant = 'segmented', className }: TabsProps) {
  const items = tabs.map((t) => (typeof t === 'string' ? { id: t, label: t } : t));
  const underline = variant === 'underline';
  return (
    <div className={cx(underline ? 'tr-tabs' : 'tabbar', className)} role="tablist">
      {items.map((t) => {
        const on = t.id === active;
        return (
          <button key={t.id} type="button" role="tab" aria-selected={on}
            className={underline ? cx('tr-tab', on && 'active') : cx('tab', on && 'tab--on')}
            onClick={() => onChange?.(t.id)}>
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
