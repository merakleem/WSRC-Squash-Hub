// ===== THE CREATE WIZARD'S FRAME =====
// The step card, summary strip, footer and the pieces the league and
// tournament wizards both draw: court chips, minute inputs, warnings and the
// navy preview hero. Each wizard owns its own steps and state; this is only
// the shared markup, so the two always look like one product.
import { esc } from './utils.js';

/**
 * The stepper card: clickable steps, the phone title and the summary strip
 * (`summaryHTML` is a run of summaryCellHTML). Steps are 1-based. Followed by
 * an empty #wizardCard for the step itself.
 */
export function wizardShellHTML({ labels, step, summaryHTML }) {
  const steps = labels.map((label, i) => {
    const num = i + 1;
    const done = num < step;
    const active = num === step;
    return `
      <div class="wz-step${done ? ' wz-step--done' : ''}${active ? ' wz-step--on' : ''}" data-step="${num}">
        <div class="wz-step-row">
          <span class="wz-line${i === 0 ? ' wz-line--none' : num <= step ? ' wz-line--fill' : ''}"></span>
          <button class="wz-dot" type="button">${done ? '&#10003;' : num}</button>
          <span class="wz-line${i === labels.length - 1 ? ' wz-line--none' : done ? ' wz-line--fill' : ''}"></span>
        </div>
        <span class="wz-step-label">${label}</span>
      </div>`;
  }).join('');
  return `
    <div class="wz-page">
      <div class="wz-stepcard">
        <div class="wz-steps">${steps}</div>
        <div class="wz-mtitle">
          <span class="wz-mtitle-name">${labels[step - 1]}</span>
          <span class="wz-mtitle-n">Step ${step} of ${labels.length}</span>
        </div>
        <div class="wz-summary" id="wzSummary">${summaryHTML}</div>
      </div>
      <div id="wizardCard"></div>
    </div>`;
}

/** Clicking a step in the stepper asks to go there. */
export function wireStepper(root, onGo) {
  root.querySelector('.wz-steps')?.addEventListener('click', (e) => {
    const step = e.target.closest('.wz-step')?.dataset.step;
    if (step) onGo(Number(step));
  });
}

/** One cell of the summary strip. `desk` hides it on a phone. */
export function summaryCellHTML(label, value, { desk = false } = {}) {
  return `
    <div class="wz-sum-cell${desk ? ' wz-sum-cell--desk' : ''}">
      <span class="wz-sum-label">${label}</span>
      <span class="wz-sum-val${value === '—' ? ' wz-sum-val--dash' : ''}">${value}</span>
    </div>`;
}

/** The step footer: the error line, then Cancel (first step) or Back, and Next. */
export function wizardFooterHTML({ cancel = false, nextDisabled = false, nextLabel = 'Next' } = {}) {
  return `
    <div class="wz-foot">
      <span id="wError" class="wz-foot-err"></span>
      <span class="wz-foot-btns">
        ${cancel
          ? '<button class="btn btn-outline" id="wCancel">Cancel</button>'
          : '<button class="btn btn-outline" id="wBack">Back</button>'}
        <button class="btn btn-primary" id="wNext"${nextDisabled ? ' disabled' : ''}>${nextLabel}</button>
      </span>
    </div>`;
}

/** The courts as toggle chips; `selected` are court ids. */
export function courtChipsHTML(allCourts, selected) {
  if (!allCourts.length) {
    return `<p class="wz-hintline">No courts set up. <a href="#" onclick="navigate('clubSettings');return false">Add courts in Club Settings</a> first.</p>`;
  }
  return `<div class="wz-courts">${allCourts.map((ct) => `
              <button class="wz-court${selected.includes(ct.id) ? ' wz-court--on' : ''}" type="button" data-court="${ct.id}">
                <span class="wz-court-tick">&#10003;</span>${esc(ct.name)}
              </button>`).join('')}
            </div>`;
}

/** A number field with a "min" unit. */
export function minuteInputHTML(id, value, { min = 0 } = {}) {
  return `
          <div class="wz-mininput">
            <input id="${id}" type="number" min="${min}" value="${value}">
            <span>min</span>
          </div>`;
}

/** An amber warning line. */
export function warnHTML(text) {
  return `
    <div class="wz-night">
      <svg viewBox="0 0 24 24" fill="none" stroke="#a8710f" stroke-width="2.2" stroke-linecap="round"><path d="M12 9v4M12 17h.01"/><circle cx="12" cy="12" r="9"/></svg>
      <span>${text}</span>
    </div>`;
}

/** The navy hero that heads the preview step: name, meta and stat tiles ([value, label]). */
export function wizardHeroHTML({ name, meta, stats }) {
  return `
      <div class="wz-hero">
        <div class="wz-hero-left">
          <span class="wz-hero-name">${esc(name)}</span>
          <span class="wz-hero-meta">${meta}</span>
        </div>
        <div class="wz-hero-stats">
          ${stats.map(([value, label]) => `
            <div class="wz-tile">
              <span class="wz-tile-val">${value}</span>
              <span class="wz-tile-label">${label}</span>
            </div>`).join('')}
        </div>
      </div>`;
}
