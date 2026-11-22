/**
 * NemesisWorkspace — petites briques d'interface, sans dépendance.
 */

/** Créer un élément : `el('div.card', { onclick }, ...enfants)`. */
export function el(spec, props, ...children) {
  const [tag, ...classes] = String(spec).split('.');
  const node = document.createElement(tag || 'div');
  if (classes.length) node.className = classes.join(' ');
  if (props && typeof props === 'object' && !(props instanceof Node) && !Array.isArray(props)) {
    for (const [key, value] of Object.entries(props)) {
      if (value == null || value === false) continue;
      if (key === 'class') node.className += ` ${value}`;
      else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
      else if (key === 'html') node.innerHTML = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key in node && key !== 'list') {
        try {
          node[key] = value;
        } catch {
          node.setAttribute(key, value);
        }
      } else node.setAttribute(key, value === true ? '' : value);
    }
  } else if (props != null) {
    children.unshift(props);
  }
  for (const child of children.flat(4)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Une icône SVG (tracés Lucide, ISC). */
export function icon(name, size = 20) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = PATHS[name] || PATHS.dot;
  return svg;
}

const PATHS = {
  doc: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h5"/>',
  sheet: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/><path d="M15 3v18"/>',
  slide: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  cloud: '<path d="M17.5 19a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.6-1.6A4 4 0 0 0 6.5 19z"/>',
  sparkles: '<path d="M12 3l1.9 4.6 4.6 1.9-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/><path d="M18 15l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"/><path d="M5 16l.6 1.4L7 18l-1.4.6L5 20l-.6-1.4L3 18l1.4-.6z"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M17 8l-5-5-5 5"/><path d="M12 3v12"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4"/><path d="M15.4 6.5l-6.8 4"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  folder: '<path d="M4 20a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2z"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  x: '<path d="M18 6L6 18"/><path d="M6 6l12 12"/>',
  chevron: '<path d="M9 18l6-6-6-6"/>',
  back: '<path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3L21 2"/><path d="M16 7l3 3"/><path d="M19 4l2 2"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  brain: '<path d="M9.5 3A3.5 3.5 0 0 0 6 6.5v.2A3.5 3.5 0 0 0 4 10a3.5 3.5 0 0 0 1.5 2.9A3.5 3.5 0 0 0 9.5 21H12V3z"/><path d="M14.5 3A3.5 3.5 0 0 1 18 6.5v.2a3.5 3.5 0 0 1 2 3.3 3.5 3.5 0 0 1-1.5 2.9A3.5 3.5 0 0 1 14.5 21H12V3z"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M9.9 5.2A9.7 9.7 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.2 3.1"/><path d="M6.6 6.6A17 17 0 0 0 2 12s3.6 7 10 7a9.6 9.6 0 0 0 4.2-.9"/><path d="M10.6 10.6a2 2 0 0 0 2.8 2.8"/><path d="M3 3l18 18"/>',
  arrowUpRight: '<path d="M7 17L17 7"/><path d="M8 7h9v9"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  layers: '<path d="M12 2L2 7l10 5 10-5z"/><path d="M2 12l10 5 10-5"/><path d="M2 17l10 5 10-5"/>',
  warning: '<path d="M12 3l9 16H3z"/><path d="M12 9v5"/><path d="M12 17h.01"/>',
  dot: '<circle cx="12" cy="12" r="2"/>',
};

/* ------------------------------------------------------------------ */
/* Notifications                                                       */
/* ------------------------------------------------------------------ */

let toastHost = null;

/** Un message bref en bas de l'écran. */
export function toast(message, { kind = 'info', duration = 4200 } = {}) {
  if (!toastHost) {
    toastHost = el('div.toast-host', { role: 'status', 'aria-live': 'polite' });
    document.body.append(toastHost);
  }
  const node = el(
    `div.toast.toast-${kind}`,
    {},
    icon(kind === 'error' ? 'warning' : kind === 'ok' ? 'check' : 'info', 17),
    el('span', {}, message),
  );
  toastHost.append(node);
  requestAnimationFrame(() => node.classList.add('is-in'));
  const close = () => {
    node.classList.remove('is-in');
    setTimeout(() => node.remove(), 220);
  };
  node.addEventListener('click', close);
  if (duration) setTimeout(close, duration);
  return close;
}

/* ------------------------------------------------------------------ */
/* Boîte de dialogue                                                    */
/* ------------------------------------------------------------------ */

/**
 * Une modale. `render(close)` construit le contenu ; `title` et `actions`
 * sont facultatifs.
 */
export function modal({ title, subtitle, render, wide = false, onClose }) {
  const close = () => {
    overlay.classList.remove('is-in');
    setTimeout(() => {
      overlay.remove();
      onClose?.();
    }, 180);
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (event) => {
    if (event.key === 'Escape') close();
  };
  const body = el('div.modal-body');
  const panel = el(
    `div.modal-panel${wide ? '.is-wide' : ''}`,
    { role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Dialogue' },
    el(
      'header.modal-head',
      {},
      el('div', {}, title ? el('h2', {}, title) : null, subtitle ? el('p.modal-sub', {}, subtitle) : null),
      el('button.icon-btn', { title: 'Fermer', onclick: close, type: 'button' }, icon('x', 18)),
    ),
    body,
  );
  const overlay = el('div.modal-overlay', { onmousedown: (event) => event.target === overlay && close() }, panel);
  body.append(render(close));
  document.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add('is-in'));
  document.addEventListener('keydown', onKey);
  setTimeout(() => panel.querySelector('input, select, textarea, button')?.focus?.(), 60);
  return { close, body, panel };
}

/** Confirmation simple, résolue à vrai / faux. */
export function confirmDialog({ title, message, confirmLabel = 'Confirmer', danger = false }) {
  return new Promise((resolve) => {
    let answered = false;
    const dialog = modal({
      title,
      render: (close) =>
        el(
          'div',
          {},
          el('p.modal-text', {}, message),
          el(
            'div.modal-actions',
            {},
            el('button.btn', { type: 'button', onclick: () => { answered = true; resolve(false); close(); } }, 'Annuler'),
            el(
              `button.btn${danger ? '.btn-danger' : '.btn-primary'}`,
              { type: 'button', onclick: () => { answered = true; resolve(true); close(); } },
              confirmLabel,
            ),
          ),
        ),
      onClose: () => {
        if (!answered) resolve(false);
      },
    });
    return dialog;
  });
}

/** Un champ de formulaire étiqueté. */
export function field(label, control, hint) {
  return el(
    'label.field',
    {},
    el('span.field-label', {}, label),
    control,
    hint ? el('span.field-hint', {}, hint) : null,
  );
}

/** Une rangée de réglage avec un interrupteur. */
export function toggleRow({ title, description, checked, onChange }) {
  const input = el('input', { type: 'checkbox', checked: !!checked, onchange: (event) => onChange?.(event.target.checked) });
  return el(
    'label.toggle-row',
    {},
    el('span.toggle-copy', {}, el('strong', {}, title), description ? el('small', {}, description) : null),
    el('span.switch', {}, input, el('span.switch-track')),
  );
}

/** Afficher un octet lisible. */
export function humanBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} o`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(0)} Ko`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} Mo`;
  return `${(value / 1024 ** 3).toFixed(2)} Go`;
}
