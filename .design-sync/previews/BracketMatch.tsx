import { BracketMatch } from 'playwsrc-ui';

const w = { width: 210 };

export const Played = () => (
  <div style={w}><BracketMatch label="QF 1" time="Sat · 10:00 AM" player1="Sam Patel" player2="Kai Okafor" score={{ p1: 3, p2: 1 }} scoreAction="Edit" /></div>
);

export const ReadyToScore = () => (
  <div style={w}><BracketMatch label="SF 1" time="Sun · 9:00 AM" player1="Sam Patel" player2="Dana Ruiz" scoreAction="Score" /></div>
);

export const Waiting = () => (
  <div style={w}><BracketMatch label="Final" /></div>
);
