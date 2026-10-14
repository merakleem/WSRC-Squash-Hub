import type { ReactNode } from 'react';
import { StatusBadge } from './StatusBadge';

export interface LeagueCardMeta {
  /** An <Icon>; the row sizes it to 14px. */
  icon?: ReactNode;
  text: ReactNode;
}

export interface LeagueCardProps {
  /** The league or tournament name. */
  name: ReactNode;
  /** The badge text, e.g. "Group Stage", "Completed". */
  status?: ReactNode;
  /** Colour of the badge. */
  statusTone?: 'active' | 'completed';
  /** Muted icon rows under the name: dates, player counts, nights. */
  meta?: LeagueCardMeta[];
  /** The footer buttons, right-aligned over a rule. */
  actions?: ReactNode;
  onClick?: () => void;
}

/**
 * The clickable card the Tournaments list (and older league lists) show one
 * per competition. Lay several out in a `.league-grid`.
 */
export function LeagueCard({ name, status, statusTone = 'active', meta = [], actions, onClick }: LeagueCardProps) {
  return (
    <div className="league-card" onClick={onClick}>
      <div className="league-card-header">
        <h3>{name}</h3>
        {status ? <StatusBadge status={statusTone}>{status}</StatusBadge> : null}
      </div>
      {meta.length ? (
        <div className="league-card-meta">
          {meta.map((m, i) => <div className="meta-row" key={i}>{m.icon}{m.text}</div>)}
        </div>
      ) : null}
      {actions ? <div className="league-card-footer">{actions}</div> : null}
    </div>
  );
}
