import { Toast } from 'playwsrc-ui';

export const Types = () => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: 320 }}>
    <Toast>Tournament saved.</Toast>
    <Toast type="success">Score saved. Sam Patel goes through.</Toast>
    <Toast type="error">Could not load that match.</Toast>
    <Toast type="warning">Court 2 is already booked at 10:00 AM.</Toast>
  </div>
);
