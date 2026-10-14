import { Input } from 'playwsrc-ui';

const col = { display: 'flex', flexDirection: 'column' as const, gap: 10, width: 320 };

export const Types = () => (
  <div style={col}>
    <Input placeholder="Player name" />
    <Input defaultValue="Spring Open 2026" />
    <Input type="number" defaultValue={16} />
    <Input type="date" defaultValue="2026-04-18" />
  </div>
);

export const Disabled = () => (
  <div style={col}>
    <Input defaultValue="Court 1" disabled />
  </div>
);
