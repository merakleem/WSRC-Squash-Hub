import { Bracket } from 'playwsrc-ui';

export const EightPlayers = () => (
  <Bracket
    rounds={[
      {
        name: 'Quarterfinals', date: 'Apr 11',
        matches: [
          { label: 'QF 1', player1: 'Sam Patel', player2: 'Kai Okafor', score: { p1: 3, p2: 1 } },
          { label: 'QF 2', player1: 'Chris Nguyen', player2: 'Dana Ruiz', score: { p1: 0, p2: 3 } },
          { label: 'QF 3', player1: 'Jordan Lee', player2: 'Taylor Brooks', score: { p1: 3, p2: 2 } },
          { label: 'QF 4', player1: 'Riley Chen', player2: 'Avery Santos', time: 'Sat · 1:00 PM', scoreAction: 'Score' },
        ],
      },
      {
        name: 'Semifinals', date: 'Apr 18',
        matches: [
          { label: 'SF 1', player1: 'Sam Patel', player2: 'Dana Ruiz', time: 'Sat · 9:00 AM', scoreAction: 'Score' },
          { label: 'SF 2', player1: 'Jordan Lee' },
        ],
      },
      { name: 'Final', date: 'Apr 18', matches: [{ label: 'Final' }] },
    ]}
  />
);

export const Completed = () => (
  <Bracket
    rounds={[
      {
        name: 'Semifinals', date: 'Nov 22',
        matches: [
          { label: 'SF 1', player1: 'Dana Ruiz', player2: 'Lee Walsh', score: { p1: 3, p2: 0 } },
          { label: 'SF 2', player1: 'Kai Okafor', player2: 'Pat Moreau', score: { p1: 3, p2: 2 } },
        ],
      },
      { name: 'Final', date: 'Nov 22', matches: [{ label: 'Final', player1: 'Dana Ruiz', player2: 'Kai Okafor', score: { p1: 3, p2: 1 } }] },
    ]}
  />
);
