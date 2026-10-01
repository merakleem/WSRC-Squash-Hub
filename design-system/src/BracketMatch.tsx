import { cx } from './cx';

export interface BracketMatchProps {
  /** The slot's label: "QF 1", "SF 2", "Final". */
  label: string;
  /** Top player; omit both players for an empty "TBD" slot. */
  player1?: string;
  player2?: string;
  /** Games each, once played. The winner is drawn bold navy. */
  score?: { p1: number; p2: number };
  /** "Sat · 10:00 AM" */
  time?: string;
  /** Show a Score / Edit button in the footer. */
  scoreAction?: 'Score' | 'Edit';
}

/**
 * One match slot in a knockout bracket: label and time, the two players with
 * their games, and an optional score button. A slot whose players are not
 * known yet shows "TBD", faded.
 */
export function BracketMatch({ label, player1, player2, score, time, scoreAction }: BracketMatchProps) {
  if (!player1 && !player2) {
    return (
      <div className="tr-bracket-card tr-bracket-card--empty">
        <div className="tr-bc-label">{label}</div>
        <div className="tr-bc-tbd">TBD</div>
      </div>
    );
  }
  const p1win = score ? score.p1 > score.p2 : false;
  return (
    <div className={cx('tr-bracket-card', score && 'tr-bracket-card--scored')}>
      <div className="tr-bc-header">
        <span className="tr-bc-label">{label}</span>
        {time ? <span className="tr-bc-time">{time}</span> : null}
      </div>
      <div className={cx('tr-bc-player', score && p1win && 'tr-bc-winner')}>
        {player1 ?? 'TBD'}{score ? <span className="tr-bc-sets">{score.p1}</span> : null}
      </div>
      <div className="tr-bc-divider" />
      <div className={cx('tr-bc-player', score && !p1win && 'tr-bc-winner')}>
        {player2 ?? 'TBD'}{score ? <span className="tr-bc-sets">{score.p2}</span> : null}
      </div>
      {scoreAction ? <div className="tr-bc-footer"><button className="tr-score-btn">{scoreAction}</button></div> : null}
    </div>
  );
}
