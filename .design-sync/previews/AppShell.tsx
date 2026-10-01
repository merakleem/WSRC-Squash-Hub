import { AppShell, Button, Icon, Tabs, GroupCard, StatusBadge } from 'playwsrc-ui';

export const TournamentPage = () => (
  <AppShell role="admin" activePage="tournaments" title="Spring Open 2026" back
    actions={<Button variant="primary" size="sm" icon={<Icon name="plus" strokeWidth={2.5} />}>Add match</Button>}>
    <div className="tr-detail">
      <div className="tr-detail-meta">
        <StatusBadge status="active">Group Stage</StatusBadge>
        <span className="tr-detail-champ-date">Championship: Saturday, April 18</span>
      </div>
      <Tabs variant="underline" tabs={[{ id: 'groups', label: 'Groups' }, { id: 'bracket', label: 'Bracket' }]} active="groups" />
      <div className="tr-groups-grid">
        <GroupCard name="A" standings={[
          { name: 'Sam Patel', wins: 2, losses: 0, setsWon: 6, setsLost: 1, advances: true },
          { name: 'Jordan Lee', wins: 1, losses: 1, setsWon: 4, setsLost: 4, advances: true },
          { name: 'Chris Nguyen', wins: 1, losses: 1, setsWon: 3, setsLost: 4 },
          { name: 'Morgan Blake', wins: 0, losses: 2, setsWon: 1, setsLost: 6 },
        ]} />
        <GroupCard name="B" standings={[
          { name: 'Dana Ruiz', wins: 2, losses: 0, setsWon: 6, setsLost: 2, advances: true },
          { name: 'Kai Okafor', wins: 1, losses: 1, setsWon: 5, setsLost: 4, advances: true },
          { name: 'Lee Walsh', wins: 1, losses: 1, setsWon: 3, setsLost: 5 },
          { name: 'Pat Moreau', wins: 0, losses: 2, setsWon: 2, setsLost: 6 },
        ]} />
      </div>
    </div>
  </AppShell>
);
