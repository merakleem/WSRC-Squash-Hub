import { Button, FormActions } from 'playwsrc-ui';

export const CancelAndSave = () => (
  <div style={{ width: 420 }}>
    <FormActions>
      <Button variant="secondary">Cancel</Button>
      <Button variant="primary">Create Tournament</Button>
    </FormActions>
  </div>
);

export const Destructive = () => (
  <div style={{ width: 420 }}>
    <FormActions>
      <Button variant="secondary">Keep it</Button>
      <Button variant="danger">Delete tournament</Button>
    </FormActions>
  </div>
);
