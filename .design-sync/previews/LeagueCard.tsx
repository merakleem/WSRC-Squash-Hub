import { LeagueCard, Button, Icon } from 'playwsrc-ui';

export const Active = () => (
  <div style={{ width: 340 }}>
    <LeagueCard
      name="Spring Open 2026"
      status="Group Stage"
      meta={[
        { icon: <Icon name="calendar" />, text: 'Championship: Saturday, April 18' },
        { icon: <Icon name="players" />, text: '16 players · 4 groups' },
      ]}
      actions={<Button variant="primary" size="sm">View Tournament</Button>}
    />
  </div>
);

export const Completed = () => (
  <div style={{ width: 340 }}>
    <LeagueCard
      name="Fall Classic 2025"
      status="Completed"
      statusTone="completed"
      meta={[{ icon: <Icon name="calendar" />, text: 'Championship: Saturday, November 22' }]}
      actions={<Button variant="primary" size="sm">View Tournament</Button>}
    />
  </div>
);

export const Grid = () => (
  <div className="league-grid" style={{ width: 700 }}>
    <LeagueCard name="Spring Open 2026" status="Knockout" meta={[{ icon: <Icon name="calendar" />, text: 'Championship: Saturday, April 18' }]} actions={<Button variant="primary" size="sm">View Tournament</Button>} />
    <LeagueCard name="Juniors Cup" status="Group Stage" meta={[{ icon: <Icon name="calendar" />, text: 'Championship: Sunday, May 3' }]} actions={<Button variant="primary" size="sm">View Tournament</Button>} />
  </div>
);
