import { WizardSteps } from 'playwsrc-ui';

const steps = ['Select Players', 'Arrange Groups', 'Settings'];

export const FirstStep = () => <div style={{ width: 600 }}><WizardSteps steps={steps} current={1} /></div>;
export const MiddleStep = () => <div style={{ width: 600 }}><WizardSteps steps={steps} current={2} /></div>;
export const LastStep = () => <div style={{ width: 600 }}><WizardSteps steps={steps} current={3} /></div>;
