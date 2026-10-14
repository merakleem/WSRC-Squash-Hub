import { ScorePicker, Modal } from 'playwsrc-ui';

export const NothingPicked = () => (
  <div style={{ width: 520 }}>
    <ScorePicker player1="Sam Patel" player2="Jordan Lee" />
  </div>
);

export const Picked = () => (
  <div style={{ width: 520 }}>
    <ScorePicker player1="Sam Patel" player2="Jordan Lee" value={{ p1: 3, p2: 1 }} />
  </div>
);

export const InModal = () => (
  <Modal title="Score Entry" size="medium" overlay={false}>
    <ScorePicker player1="Chris Nguyen" player2="Dana Ruiz" value={{ p1: 2, p2: 3 }} canClear />
  </Modal>
);
