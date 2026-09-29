/** Tiny DOM helpers for the pixel UI. */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls?: string, parent?: HTMLElement | null, text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

export function button(parent: HTMLElement, label: string, onClick: () => void, width = 200, cls = ''): HTMLButtonElement {
  const b = el('button', `mc-button ${cls}`, parent, label);
  b.style.width = `${width}px`;
  b.addEventListener('click', (e) => {
    e.preventDefault();
    if (b.disabled) return;
    onClick();
  });
  b.addEventListener('mouseenter', () => uiSound?.('hover'));
  b.addEventListener('mousedown', () => { if (!b.disabled) uiSound?.('click'); });
  return b;
}

/** Hook for button click sounds, set by the audio system. */
export let uiSound: ((kind: 'click' | 'hover') => void) | null = null;
export function setUiSound(fn: (kind: 'click' | 'hover') => void): void {
  uiSound = fn;
}

export function slider(
  parent: HTMLElement, label: (v: number) => string, value: number, onChange: (v: number) => void, width = 150,
): HTMLDivElement {
  const wrap = el('div', 'mc-slider', parent);
  wrap.style.width = `${width}px`;
  const knob = el('div', 'mc-slider-knob', wrap);
  const text = el('div', 'mc-slider-label', wrap, label(value));
  let v = value;
  const place = () => {
    knob.style.left = `${Math.round(v * (width - 8))}px`;
    text.textContent = label(v);
  };
  place();
  let dragging = false;
  const update = (clientX: number) => {
    const rect = wrap.getBoundingClientRect();
    v = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    place();
    onChange(v);
  };
  wrap.addEventListener('mousedown', (e) => { dragging = true; update(e.clientX); uiSound?.('click'); });
  window.addEventListener('mousemove', (e) => { if (dragging) update(e.clientX); });
  window.addEventListener('mouseup', () => { dragging = false; });
  return wrap;
}

export function clearChildren(e: HTMLElement): void {
  while (e.firstChild) e.removeChild(e.firstChild);
}
