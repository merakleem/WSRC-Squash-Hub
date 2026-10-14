import { useState } from 'react';
import { cx } from './cx';

export interface MatchScore { p1: number; p2: number }

// Best of five: one side must win three games.
const PRESETS: MatchScore[] = [
  { p1: 3, p2: 0 }, { p1: 3, p2: 1 }, { p1: 3, p2: 2 },
  { p1: 0, p2: 3 }, { p1: 1, p2: 3 }, { p1: 2, p2: 3 },
];

export interface ScorePickerProps {
  player1: string;
  player2: string;
  /** The score picked so far; none leaves Save disabled. */
  value?: MatchScore;
  onChange?: (score: MatchScore) => void;
  /** Offer "Clear Score" (an admin editing a saved score). */
  canClear?: boolean;
}

/**
 * The tournament score entry: the matchup, the six possible best-of-five
 * results as big tap targets (each naming its winner), and Cancel / Save.
 * It is the body of a <Modal title="Score Entry" size="medium">.
 */
export function ScorePicker({ player1, player2, value, onChange, canClear }: ScorePickerProps) {
  const [sel, setSel] = useState<MatchScore | undefined>(value);
  const first = (n: string) => n.split(' ')[0];
  return (
    <div className="tr-score-modal">
      <div className="tr-score-matchup">
        <span className="tr-score-p1name">{player1}</span>
        <span className="tr-score-vs">vs</span>
        <span className="tr-score-p2name">{player2}</span>
      </div>
      <div className="tr-preset-grid">
        {PRESETS.map((pr) => {
          const on = sel?.p1 === pr.p1 && sel?.p2 === pr.p2;
          const p1wins = pr.p1 > pr.p2;
          return (
            <button key={`${pr.p1}-${pr.p2}`} type="button" className={cx('tr-preset-btn', on && 'tr-preset-btn--selected')}
              onClick={() => { setSel(pr); onChange?.(pr); }}>
              <span className="tr-preset-score">{p1wins ? `${pr.p1}–${pr.p2}` : `${pr.p2}–${pr.p1}`}</span>
              <span className="tr-preset-winner">{first(p1wins ? player1 : player2)} wins</span>
            </button>
          );
        })}
      </div>
      <div className="tr-score-actions">
        {canClear ? <button type="button" className="btn btn-ghost">Clear Score</button> : null}
        <button type="button" className="btn btn-ghost">Cancel</button>
        <button type="button" className="btn btn-primary" disabled={!sel}>Save Score</button>
      </div>
    </div>
  );
}
