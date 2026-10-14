import { BracketMatch, type BracketMatchProps } from './BracketMatch';

export interface BracketRound {
  /** "Quarterfinals", "Semifinals", "Final". */
  name: string;
  /** "Apr 18" - shown beside the round name. */
  date?: string;
  /** The round's slots, top to bottom. Each round has half the slots of the one before. */
  matches: BracketMatchProps[];
}

export interface BracketProps {
  /** Rounds, left to right. */
  rounds: BracketRound[];
}

/**
 * A knockout bracket: one column per round, left to right, each slot centred
 * against the two it follows from. Scrolls sideways on a phone.
 */
export function Bracket({ rounds }: BracketProps) {
  return (
    <div className="tr-bracket-panel">
      <div className="tr-bracket" style={{ alignItems: 'stretch' }}>
        {rounds.map((r) => (
          <div className="tr-bracket-col" key={r.name}>
            <div className="tr-bracket-round-hd">
              {r.name}{r.date ? <span className="tr-bracket-round-date">{r.date}</span> : null}
            </div>
            {/* The app spaces its fixed 8-player bracket with spacer divs; an
                even spread gives the same centring for any number of rounds. */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-around', gap: 12 }}>
              {r.matches.map((m, i) => <BracketMatch key={i} {...m} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
