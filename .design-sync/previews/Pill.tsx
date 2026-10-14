import { Pill } from 'playwsrc-ui';

const row = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' as const };

export const Colours = () => (
  <div style={row}>
    <Pill color="green">Signed up</Pill>
    <Pill color="blue">Open</Pill>
    <Pill color="grey">Past</Pill>
    <Pill color="red">Missed</Pill>
    <Pill color="amber">Pending</Pill>
  </div>
);

export const OnNavy = () => (
  <div style={{ ...row, background: '#1e2758', borderRadius: 10, padding: 14, width: 'fit-content' }}>
    <Pill color="hero-green">Signed up</Pill>
    <Pill color="hero-blue">Open</Pill>
    <Pill color="hero-grey">Past</Pill>
  </div>
);
