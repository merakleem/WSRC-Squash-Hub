import { Chip } from 'playwsrc-ui';

export const Types = () => (
  <div style={{ display: 'flex', gap: 8 }}>
    <Chip type="league">League</Chip>
    <Chip type="tournament">Tournament</Chip>
    <Chip type="members">Members</Chip>
  </div>
);

export const OnNavy = () => (
  <div style={{ background: '#1e2758', borderRadius: 10, padding: 14, width: 'fit-content' }}>
    <Chip type="hero">Tournament</Chip>
  </div>
);
