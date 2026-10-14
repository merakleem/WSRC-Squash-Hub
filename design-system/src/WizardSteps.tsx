export interface WizardStepsProps {
  /** Step labels, in order. */
  steps: string[];
  /** The 1-based step the user is on. Earlier steps show a tick. */
  current: number;
}

/**
 * The numbered progress row across the top of a create flow (new tournament,
 * new league): done steps green with a tick, the current one blue.
 */
export function WizardSteps({ steps, current }: WizardStepsProps) {
  return (
    <div className="wizard-steps">
      {steps.map((label, i) => {
        const n = i + 1;
        const state = n < current ? 'done' : n === current ? 'active' : '';
        return [
          <div key={`s${n}`} className={`wizard-step ${state}`.trim()}>
            <div className="step-num">{n < current ? '✓' : n}</div>
            <span className="step-label">{label}</span>
          </div>,
          i < steps.length - 1
            ? <div key={`c${n}`} className={`step-connector ${n < current ? 'done' : ''}`.trim()} />
            : null,
        ];
      })}
    </div>
  );
}
