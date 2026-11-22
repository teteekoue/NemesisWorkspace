/**
 * NemesisWorkspace — point d'entrée de l'accueil.
 *
 * L'application s'ouvre directement ici : un mur, trois applications, les
 * fichiers récents et les sauvegardes locales. Aucun compte n'est demandé.
 */

import './styles/tokens.css';
import './styles/base.css';
import './styles/shell.css';
import './styles/panels.css';

import '../../shared/local-sdk.js';
import { installLocalSdk } from '../../shared/local-sdk.js';
import { loadConfig } from '../../shared/config.js';
import { isNative, platform, setNativeTheme } from '../../shared/bridge.js';
import { mountHome } from './shell/home.js';
import { el } from './ui/dom.js';

/* ---------- thème ---------- */

function applyTheme() {
  const stored = localStorage.getItem('nemesis:theme');
  const configured = loadConfig().theme;
  const theme = stored || (configured === 'system' || !configured ? null : configured);
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;

  const dark =
    theme === 'dark' ||
    (!theme && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.resolved = dark ? 'dark' : 'light';
  setNativeTheme(dark ? 'dark' : 'light');
}

/* ---------- démarrage ---------- */

async function start() {
  applyTheme();
  installLocalSdk();
  document.documentElement.dataset.platform = platform();
  if (isNative()) document.documentElement.classList.add('is-native');

  const root = document.getElementById('root');
  try {
    mountHome(root);
  } catch (error) {
    console.error(error);
    root.replaceChildren(
      el(
        'div.fatal',
        {},
        el('h1', {}, 'NemesisWorkspace n’a pas pu démarrer'),
        el('p', {}, error?.message || String(error)),
        el('button.btn.btn-primary', { type: 'button', onclick: () => location.reload() }, 'Réessayer'),
      ),
    );
  }

  window.addEventListener('nemesis:theme', applyTheme);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') applyTheme();
  });

  if (!isNative()) {
    console.info(
      '%cNemesisWorkspace%c — édition web. Les fichiers sont stockés dans IndexedDB sur cette origine.',
      'background:#6f5bff;color:#fff;padding:2px 6px;border-radius:4px;font-weight:600',
      'color:#6b7295',
    );
  }
}

start();
