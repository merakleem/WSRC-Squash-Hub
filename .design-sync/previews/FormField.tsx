import { FormField, Input, Select } from 'playwsrc-ui';

export const TextField = () => (
  <div style={{ width: 380 }}>
    <FormField label="Tournament name" htmlFor="tn">
      <Input id="tn" defaultValue="Spring Open 2026" />
    </FormField>
  </div>
);

export const WithHint = () => (
  <div style={{ width: 380 }}>
    <FormField label="Entry fee" hint="(optional)">
      <Input type="number" placeholder="0" />
    </FormField>
  </div>
);

export const WithError = () => (
  <div style={{ width: 380 }}>
    <FormField label="Championship date" error="Pick a date after the group stage ends.">
      <Input type="date" defaultValue="2026-04-02" />
    </FormField>
  </div>
);

export const WithSelect = () => (
  <div style={{ width: 380 }}>
    <FormField label="Format">
      <Select options={['Groups + knockout', 'Knockout only', 'Round robin']} defaultValue="Groups + knockout" />
    </FormField>
  </div>
);
