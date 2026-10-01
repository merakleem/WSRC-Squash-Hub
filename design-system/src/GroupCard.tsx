import { cx } from './cx';

export interface GroupStanding {
  name: string;
  wins: number;
  losses: number;
  /** Games won and lost, shown as "Sets". Omit before any are played. */
  setsWon?: number;
  setsLost?: number;
  /** Goes through to the knockout: green row and dot. */
  advances?: boolean;
}

export interface GroupMatch {
  player1: string;
  player2: string;
  /** Games each, once played: { p1: 3, p2: 1 }. */
  score?: { p1: number; p2: number };
  /** "Apr 4 · 10:00 AM" */
  when?: string;
  /** Show a Score / Edit button on the row. */
  scoreAction?: 'Score' | 'Edit';
}

export interface GroupCardProps {
  /** The group's letter or name; drawn as "Group A". */
  name: string;
  /** Standings, in order. */
  standings: GroupStanding[];
  /** The group's round-robin matches. */
  matches?: GroupMatch[];
}

/**
 * One group of a tournament's group stage: a navy header with progress, the
 * standings (advancing players tinted green), then every match in the group
 * with its score or "vs". Lay groups out two across in `.tr-groups-grid`.
 */
export function GroupCard({ name, standings, matches = [] }: GroupCardProps) {
  const played = matches.filter((m) => m.score).length;
  return (
    <div className="tr-group-card">
      <div className="tr-group-header">
        <span className="tr-group-name">Group {name}</span>
        {matches.length ? <span className="tr-group-progress">{played}/{matches.length} played</span> : null}
      </div>
      <div className="tr-standings-table">
        <div className="tr-standings-head">
          <span className="tr-standing-pos" />
          <span className="tr-standing-name">Player</span>
          <span className="tr-standing-wl">W–L</span>
          <span className="tr-standing-sets">Sets</span>
          <span />
        </div>
        {standings.map((s, i) => (
          <div className={cx('tr-standing-row', s.advances && 'tr-standing-advance')} key={s.name}>
            <span className="tr-standing-pos">{i + 1}</span>
            <span className="tr-standing-name">{s.name}</span>
            <span className="tr-standing-wl">{s.wins}–{s.losses}</span>
            <span className="tr-standing-sets">{s.setsWon || s.setsLost ? `${s.setsWon ?? 0}–${s.setsLost ?? 0}` : '—'}</span>
            {s.advances ? <span className="tr-advance-dot" title="Advances to knockout" /> : <span />}
          </div>
        ))}
      </div>
      {matches.length ? (
        <div className="tr-match-list">
          {matches.map((m, i) => {
            const p1win = m.score ? m.score.p1 > m.score.p2 : false;
            return (
              <div className="tr-match-row" key={i}>
                <div className="tr-match-names">
                  <span className={m.score && p1win ? 'tr-match-winner' : undefined}>{m.player1}</span>
                  {m.score
                    ? <span className="tr-match-score-pill tr-score-p1">{m.score.p1}–{m.score.p2}</span>
                    : <span className="tr-match-score-pill tr-score-pending">vs</span>}
                  <span className={m.score && !p1win ? 'tr-match-winner' : undefined}>{m.player2}</span>
                </div>
                <div className="tr-match-row-right">
                  {m.when ? <span className="tr-match-time-info">{m.when}</span> : null}
                  {m.scoreAction ? <button className="tr-score-btn">{m.scoreAction}</button> : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
