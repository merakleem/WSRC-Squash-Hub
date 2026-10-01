import type { ReactNode } from 'react';

export interface TableCardProps {
  /** Left side of the toolbar - a title or a <SearchInput>. Omit both for no toolbar. */
  toolbar?: ReactNode;
  /** Right side of the toolbar - usually a <Button size="sm">. */
  toolbarActions?: ReactNode;
  /** The content: a plain <table> with <thead>/<tbody> (the stylesheet styles bare table elements), or an <EmptyState>. */
  children: ReactNode;
}

/**
 * The white rounded card that holds a table or a list, with an optional
 * toolbar row. Also the frame for an empty page's <EmptyState>.
 */
export function TableCard({ toolbar, toolbarActions, children }: TableCardProps) {
  return (
    <div className="table-card">
      {toolbar || toolbarActions
        ? <div className="table-toolbar"><div>{toolbar}</div><div className="td-actions">{toolbarActions}</div></div>
        : null}
      {children}
    </div>
  );
}
