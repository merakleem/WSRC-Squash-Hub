import { Tabs } from 'playwsrc-ui';

export const Segmented = () => (
  <div style={{ width: 'fit-content' }}>
    <Tabs tabs={['Upcoming', 'Past']} active="Upcoming" />
  </div>
);

export const SegmentedThree = () => (
  <div style={{ width: 'fit-content' }}>
    <Tabs tabs={[{ id: 'standings', label: 'Standings' }, { id: 'schedule', label: 'Schedule' }, { id: 'players', label: 'Players' }]} active="schedule" />
  </div>
);

export const Underline = () => (
  <div style={{ width: 480 }}>
    <Tabs variant="underline" tabs={[{ id: 'groups', label: 'Groups' }, { id: 'bracket', label: 'Bracket' }, { id: 'results', label: 'Results' }]} active="groups" />
  </div>
);
