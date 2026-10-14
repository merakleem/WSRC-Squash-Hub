import { Modal, FormField, Input, Select, FormActions, Button } from 'playwsrc-ui';

export const FormModal = () => (
  <Modal title="New Tournament" overlay={false}>
    <FormField label="Tournament name"><Input defaultValue="Spring Open 2026" /></FormField>
    <FormField label="Format"><Select options={['Groups + knockout', 'Knockout only']} /></FormField>
    <FormField label="Championship date"><Input type="date" defaultValue="2026-04-18" /></FormField>
    <FormActions>
      <Button variant="secondary">Cancel</Button>
      <Button variant="primary">Create Tournament</Button>
    </FormActions>
  </Modal>
);

export const Confirm = () => (
  <Modal title="Delete tournament?" overlay={false}>
    <p style={{ fontSize: 13.5, color: '#6b7e93', lineHeight: 1.55 }}>
      Spring Open 2026 and all 32 of its matches will be removed. Scores already reported stay on each player's record.
    </p>
    <FormActions>
      <Button variant="secondary">Keep it</Button>
      <Button variant="danger">Delete tournament</Button>
    </FormActions>
  </Modal>
);
