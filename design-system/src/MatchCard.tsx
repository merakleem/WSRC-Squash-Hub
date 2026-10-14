import { useState } from 'react';
import { cx } from './cx';
import { Avatar } from './Avatar';
import { Icon } from './Icon';

export interface MatchCardPlayer {
  name: string;
  photoUrl?: string;
  /** e.g. "#4 on ladder · 1512" or "Not on ladder yet". */
  meta?: string;
  /** Rating change from this match: +12 / -8. Omit or 0 for none. */
  ratingChange?: number;
  /** Marks the winner of a played match. */
  won?: boolean;
  /** The signed-in player: gets the blue "you" ring. */
  you?: boolean;
}

export interface MatchCardMeeting {
  /** "Mar 14, 2026" */
  date: string;
  /** Winner's name. */
  winner: string;
  /** "3-1" */
  score: string;
}

export interface MatchCardProps {
  /** The band across the top: "Spring Open · Semifinal", "Ladder match". */
  kicker: string;
  /** The two players, left then right. */
  players: [MatchCardPlayer, MatchCardPlayer];
  /** played shows the score; scheduled a blue when-strip; unscheduled a grey one. */
  status: 'played' | 'scheduled' | 'unscheduled';
  /** Games score, e.g. "3-1". Shown when played. */
  score?: string;
  /** The strip's first line: "Saturday, April 4 · 10:00 AM" or "Played Tuesday, March 3". */
  whenTitle: string;
  /** The strip's second line, e.g. the court. */
  whenSub?: string;
  /** Head-to-head summary: "Sam leads 3-1". */
  h2hLead?: string;
  /** Share of past meetings the left player won, 0-100. Drives the bar. */
  h2hLeftPct?: number;
  /** Past meetings, newest first. Empty means a first meeting. */
  meetings?: MatchCardMeeting[];
  /** Start with the head-to-head expanded. */
  h2hOpen?: boolean;
  /** Offer the "Submit score" button (one of the players, not yet played). */
  canSubmitScore?: boolean;
  /** Draw the dimmed backdrop, as when the app opens it. */
  overlay?: boolean;
}

/**
 * The one card that describes a match, opened wherever a match is drawn -
 * dashboard, profile, league page, tournament, schedule. Two players face
 * off around the score (or "VS"), a strip says when, and the head-to-head
 * folds out below. It is always shown in the modal panel.
 */
export function MatchCard({ kicker, players, status, score, whenTitle, whenSub, h2hLead, h2hLeftPct = 0, meetings = [], h2hOpen = false, canSubmitScore, overlay = false }: MatchCardProps) {
  const [open, setOpen] = useState(h2hOpen);
  const played = status === 'played';
  const player = (p: MatchCardPlayer) => (
    <div className="mc-player">
      <Avatar name={p.name} photoUrl={p.photoUrl} size="lg" you={p.you} />
      <button className="mc-name">{p.name}</button>
      {p.meta ? <span className="mc-meta">{p.meta}</span> : null}
      {p.ratingChange ? (
        <span className={cx('mc-delta', p.ratingChange > 0 ? 'mc-delta--up' : 'mc-delta--down')}>
          {p.ratingChange > 0 ? '+' : '−'}{Math.abs(p.ratingChange)}
        </span>
      ) : null}
      {p.won ? <span className="mc-winner">Winner</span> : null}
    </div>
  );
  const panel = (
    <div className="modal" role="dialog">
      <div className="modal-body">
        <div className="mc-card">
          <div className="mc-band">
            <span className="mc-kicker">{kicker}</span>
            <button className="mc-close" aria-label="Close"><Icon name="close" strokeWidth={2.2} /></button>
          </div>
          <div className="mc-players">
            {player(players[0])}
            <div className="mc-centre">
              <span className={played ? 'mc-score' : 'mc-vs'}>{played ? score : 'VS'}</span>
              {played ? <span className="mc-final">Final</span> : null}
            </div>
            {player(players[1])}
          </div>
          <div className={`mc-strip mc-strip--${status}`}>
            <span className="mc-strip-title">{whenTitle}</span>
            {whenSub ? <span className="mc-strip-sub">{whenSub}</span> : null}
          </div>
          <div className={cx('mc-h2h', open && 'mc-h2h--open')}>
            <button className="mc-h2h-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
              <span>{open ? 'Hide head-to-head' : 'View head-to-head'}</span>
              <Icon name="chevronDown" strokeWidth={2.4} />
            </button>
            <div className="mc-h2h-body">
              <div className="mc-h2h-head">
                <span className="mc-h2h-label">Head to head</span>
                {h2hLead ? <span className="mc-h2h-lead">{h2hLead}</span> : null}
              </div>
              {meetings.length ? (
                <>
                  <div className="mc-bar"><span className="mc-bar-fill" style={{ width: `${h2hLeftPct}%` }} /></div>
                  <div className="mc-meetings">
                    {meetings.map((m, i) => (
                      <div className="mc-meeting" key={i}>
                        <span className="mc-meeting-date">{m.date}</span>
                        <span className="mc-meeting-who">{m.winner}</span>
                        <span className="mc-meeting-score">{m.score}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : <div className="mc-h2h-empty">First meeting. These two have never played.</div>}
            </div>
          </div>
          {canSubmitScore ? (
            <div className="mc-foot"><button className="btn btn-primary btn-lg btn-block">Submit score</button></div>
          ) : null}
        </div>
      </div>
    </div>
  );
  return overlay ? <div className="modal-overlay open">{panel}</div> : panel;
}
