import { TableCard, SearchInput, Button, Icon, Pill, EmptyState } from 'playwsrc-ui';

export const PlayersTable = () => (
  <div style={{ width: 720 }}>
    <TableCard toolbar={<SearchInput />} toolbarActions={<Button variant="primary" size="sm" icon={<Icon name="plus" strokeWidth={2.5} />}>Add Player</Button>}>
      <table>
        <thead><tr><th>Player</th><th>Ladder</th><th>Rating</th><th>Status</th></tr></thead>
        <tbody>
          <tr><td>Sam Patel</td><td>#3</td><td>1542</td><td><Pill color="green">Active</Pill></td></tr>
          <tr><td>Jordan Lee</td><td>#5</td><td>1498</td><td><Pill color="green">Active</Pill></td></tr>
          <tr><td>Chris Nguyen</td><td>#8</td><td>1431</td><td><Pill color="amber">Pending</Pill></td></tr>
          <tr><td>Morgan Blake</td><td>—</td><td>—</td><td><Pill color="grey">Inactive</Pill></td></tr>
        </tbody>
      </table>
    </TableCard>
  </div>
);

export const TableOnly = () => (
  <div style={{ width: 520 }}>
    <TableCard>
      <table>
        <thead><tr><th>Member</th><th>No.</th><th>Guests</th></tr></thead>
        <tbody>
          <tr><td>Riley Chen</td><td>1042</td><td>1</td></tr>
          <tr><td>Avery Santos</td><td>1187</td><td>0</td></tr>
          <tr><td>Jamie Ford</td><td>0951</td><td>2</td></tr>
        </tbody>
      </table>
    </TableCard>
  </div>
);

export const Empty = () => (
  <div style={{ width: 620 }}>
    <TableCard>
      <EmptyState title="No tournaments yet">Create your first tournament to get started.</EmptyState>
    </TableCard>
  </div>
);
