import { Select } from 'playwsrc-ui';

export const WithOptions = () => (
  <div style={{ width: 320 }}>
    <Select options={[{ value: 'c1', label: 'Court 1' }, { value: 'c2', label: 'Court 2' }, { value: 'c3', label: 'Court 3' }]} defaultValue="c2" />
  </div>
);

export const Disabled = () => (
  <div style={{ width: 320 }}>
    <Select options={['Best of five']} disabled />
  </div>
);
