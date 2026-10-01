import { StatusBadge } from 'playwsrc-ui';

export const Statuses = () => (
  <div style={{ display: 'flex', gap: 8 }}>
    <StatusBadge status="active">Group Stage</StatusBadge>
    <StatusBadge status="active">Knockout</StatusBadge>
    <StatusBadge status="completed">Completed</StatusBadge>
  </div>
);
