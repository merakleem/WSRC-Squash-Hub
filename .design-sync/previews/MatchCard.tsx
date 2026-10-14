import { MatchCard } from 'playwsrc-ui';

export const Played = () => (
  <MatchCard
    kicker="Spring Open · Semifinal"
    status="played"
    score="3-1"
    players={[
      { name: 'Sam Patel', meta: '#3 on ladder · 1542', ratingChange: 14, won: true, you: true },
      { name: 'Jordan Lee', meta: '#5 on ladder · 1498', ratingChange: -14 },
    ]}
    whenTitle="Played Saturday, April 18"
    h2hLead="Sam leads 3-1"
    h2hLeftPct={75}
    meetings={[
      { date: 'Apr 18, 2026', winner: 'Sam Patel', score: '3-1' },
      { date: 'Feb 2, 2026', winner: 'Jordan Lee', score: '3-2' },
      { date: 'Nov 11, 2025', winner: 'Sam Patel', score: '3-0' },
      { date: 'Sep 20, 2025', winner: 'Sam Patel', score: '3-2' },
    ]}
    h2hOpen
  />
);

export const Scheduled = () => (
  <MatchCard
    kicker="Spring Open · Group Stage"
    status="scheduled"
    players={[
      { name: 'Chris Nguyen', meta: '#8 on ladder · 1431', you: true },
      { name: 'Morgan Blake', meta: 'Not on ladder yet' },
    ]}
    whenTitle="Saturday, April 4 · 10:00 AM"
    whenSub="Court 2"
    canSubmitScore
  />
);

export const Unscheduled = () => (
  <MatchCard
    kicker="Winter League · Division 2 · Week 3"
    status="unscheduled"
    players={[
      { name: 'Taylor Brooks', meta: '#12 on ladder · 1380' },
      { name: 'Riley Chen', meta: '#14 on ladder · 1362' },
    ]}
    whenTitle="Not yet scheduled"
    whenSub="No court or time set for this match."
  />
);
