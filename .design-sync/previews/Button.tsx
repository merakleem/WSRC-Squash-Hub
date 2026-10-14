import { Button, Icon } from 'playwsrc-ui';

const row = { display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' as const };

export const Variants = () => (
  <div style={row}>
    <Button variant="primary">Save Score</Button>
    <Button variant="secondary">Cancel</Button>
    <Button variant="danger-outline">Delete tournament</Button>
    <Button variant="danger">Confirm delete</Button>
    <Button variant="success">Mark as played</Button>
    <Button variant="ghost">Clear Score</Button>
  </div>
);

export const Sizes = () => (
  <div style={row}>
    <Button variant="primary" size="sm">View Tournament</Button>
    <Button variant="primary">Create Tournament</Button>
    <Button variant="primary" size="lg">Submit score</Button>
  </div>
);

export const WithIcon = () => (
  <div style={row}>
    <Button variant="primary" icon={<Icon name="plus" strokeWidth={2.5} />}>New Tournament</Button>
    <Button variant="secondary" size="sm" icon={<Icon name="calendar" />}>Set dates</Button>
  </div>
);

export const Disabled = () => (
  <div style={row}>
    <Button variant="primary" disabled>Save Score</Button>
    <Button variant="secondary" disabled>Back</Button>
  </div>
);

export const Block = () => (
  <div style={{ width: 320 }}>
    <Button variant="primary" size="lg" block>Submit score</Button>
  </div>
);
