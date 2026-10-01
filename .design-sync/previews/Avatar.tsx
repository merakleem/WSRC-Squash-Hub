import { Avatar } from 'playwsrc-ui';

const row = { display: 'flex', gap: 12, alignItems: 'center' };

export const Sizes = () => (
  <div style={row}>
    <Avatar name="Sam Patel" size="sm" />
    <Avatar name="Sam Patel" size="md" />
    <Avatar name="Sam Patel" size="lg" />
  </div>
);

export const NameColours = () => (
  <div style={row}>
    <Avatar name="Jordan Lee" />
    <Avatar name="Chris Nguyen" />
    <Avatar name="Morgan Blake" />
    <Avatar name="Taylor Brooks" />
    <Avatar name="Riley Chen" />
    <Avatar name="Avery Santos" />
  </div>
);

export const You = () => (
  <div style={{ ...row, padding: 8 }}>
    <Avatar name="Sam Patel" size="lg" you />
    <Avatar name="Jordan Lee" size="lg" />
  </div>
);
