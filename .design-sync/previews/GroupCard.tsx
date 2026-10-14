import { GroupCard } from 'playwsrc-ui';

export const InProgress = () => (
  <div style={{ width: 460 }}>
    <GroupCard
      name="A"
      standings={[
        { name: 'Sam Patel', wins: 2, losses: 0, setsWon: 6, setsLost: 1, advances: true },
        { name: 'Jordan Lee', wins: 1, losses: 1, setsWon: 4, setsLost: 4, advances: true },
        { name: 'Chris Nguyen', wins: 1, losses: 1, setsWon: 3, setsLost: 4 },
        { name: 'Morgan Blake', wins: 0, losses: 2, setsWon: 1, setsLost: 6 },
      ]}
      matches={[
        { player1: 'Sam Patel', player2: 'Morgan Blake', score: { p1: 3, p2: 0 }, when: 'Apr 4 · 10:00 AM', scoreAction: 'Edit' },
        { player1: 'Jordan Lee', player2: 'Chris Nguyen', score: { p1: 3, p2: 2 }, when: 'Apr 4 · 11:00 AM', scoreAction: 'Edit' },
        { player1: 'Sam Patel', player2: 'Chris Nguyen', score: { p1: 3, p2: 1 }, when: 'Apr 5 · 9:00 AM', scoreAction: 'Edit' },
        { player1: 'Morgan Blake', player2: 'Jordan Lee', score: { p1: 1, p2: 3 }, when: 'Apr 5 · 10:00 AM', scoreAction: 'Edit' },
        { player1: 'Sam Patel', player2: 'Jordan Lee', when: 'Apr 6 · 9:00 AM', scoreAction: 'Score' },
        { player1: 'Chris Nguyen', player2: 'Morgan Blake', when: 'Apr 6 · 10:00 AM', scoreAction: 'Score' },
      ]}
    />
  </div>
);

export const NotStarted = () => (
  <div style={{ width: 460 }}>
    <GroupCard
      name="B"
      standings={[
        { name: 'Taylor Brooks', wins: 0, losses: 0 },
        { name: 'Riley Chen', wins: 0, losses: 0 },
        { name: 'Avery Santos', wins: 0, losses: 0 },
        { name: 'Jamie Ford', wins: 0, losses: 0 },
      ]}
      matches={[
        { player1: 'Taylor Brooks', player2: 'Jamie Ford', when: 'Apr 4 · 10:00 AM' },
        { player1: 'Riley Chen', player2: 'Avery Santos', when: 'Apr 4 · 11:00 AM' },
      ]}
    />
  </div>
);

export const StandingsOnly = () => (
  <div style={{ width: 460 }}>
    <GroupCard
      name="C"
      standings={[
        { name: 'Dana Ruiz', wins: 3, losses: 0, setsWon: 9, setsLost: 2, advances: true },
        { name: 'Kai Okafor', wins: 2, losses: 1, setsWon: 7, setsLost: 5, advances: true },
        { name: 'Lee Walsh', wins: 1, losses: 2, setsWon: 4, setsLost: 7 },
        { name: 'Pat Moreau', wins: 0, losses: 3, setsWon: 2, setsLost: 9 },
      ]}
    />
  </div>
);
