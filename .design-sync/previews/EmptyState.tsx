import { EmptyState, TableCard, Button } from 'playwsrc-ui';

export const MessageOnly = () => (
  <div style={{ width: 560 }}>
    <TableCard>
      <EmptyState title="No leagues yet">No leagues have been created yet.</EmptyState>
    </TableCard>
  </div>
);

export const WithAction = () => (
  <div style={{ width: 560 }}>
    <TableCard>
      <EmptyState title="No standings yet" action={<Button variant="primary">Report a ladder match</Button>}>
        No matches have been played in Winter 2026 yet.
      </EmptyState>
    </TableCard>
  </div>
);
