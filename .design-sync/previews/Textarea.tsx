import { Textarea } from 'playwsrc-ui';

export const Filled = () => (
  <div style={{ width: 380 }}>
    <Textarea rows={4} defaultValue={'Group matches run Saturday and Sunday mornings.\nThe top two in each group go through to the quarterfinals.'} />
  </div>
);

export const Empty = () => (
  <div style={{ width: 380 }}>
    <Textarea placeholder="Notes for players" />
  </div>
);
