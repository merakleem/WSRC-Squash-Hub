import { Checkbox } from 'playwsrc-ui';

export const States = () => (
  <div style={{ width: 320 }}>
    <Checkbox label="Email players their schedule" defaultChecked />
    <Checkbox label="Open to members only" />
    <Checkbox label="Allow doubles pairs" disabled />
  </div>
);
