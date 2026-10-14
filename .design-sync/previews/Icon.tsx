import { Icon, type IconName } from 'playwsrc-ui';

const names: IconName[] = ['dashboard', 'ladder', 'leagues', 'trophy', 'ticket', 'court', 'players', 'activity', 'clock', 'settings', 'calendar', 'plus', 'check', 'close', 'back', 'chevronDown', 'chevronRight', 'profile', 'logout', 'shield'];

export const AllIcons = () => (
  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 96px)', gap: 14 }}>
    {names.map((n) => (
      <div key={n} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, fontSize: 11, color: '#6b7e93' }}>
        <Icon name={n} width={22} height={22} style={{ color: '#1e2758' }} />
        {n}
      </div>
    ))}
  </div>
);

export const OnNavy = () => (
  <div style={{ display: 'flex', gap: 18, padding: 16, background: '#1e2758', borderRadius: 10, color: 'rgba(255,255,255,.72)', width: 'fit-content' }}>
    <Icon name="dashboard" width={17} height={17} strokeWidth={1.9} />
    <Icon name="ladder" width={17} height={17} strokeWidth={1.9} />
    <Icon name="trophy" width={17} height={17} strokeWidth={1.9} />
    <Icon name="court" width={17} height={17} strokeWidth={1.9} />
    <Icon name="players" width={17} height={17} strokeWidth={1.9} />
  </div>
);
