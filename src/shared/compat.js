/**
 * NemesisWorkspace — raccord pour les moteurs anciens.
 *
 * Ce fichier est inséré tel quel, en script classique, en tête de chaque page
 * (voir `dev/compat-head.mjs`) : il s'exécute donc avant le moindre module.
 *
 * Les quatre applications sont embarquées dans l'application Android et
 * tournent parfois sur une vue système ancienne (Android 8, Chromebook
 * d'entreprise) : les API récentes qu'elles utilisent sans y penser y
 * manquent, et la page reste alors blanche. Ce module est importé en tout
 * premier par chaque point d'entrée, donc chargé avant le reste du code.
 *
 * Rien n'est remplacé quand le moteur fait déjà le travail.
 */

// La racine se devine sans `globalThis`, absent justement des moteurs anciens.
const root = typeof window !== 'undefined' ? window
  : typeof self !== 'undefined' ? self : global;

const notThere = (value) => typeof value !== 'function';

const textNodes = (items) => {
  const out = [];
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    out.push(item && item.nodeType ? item : document.createTextNode(String(item)));
  }
  return out;
};

/** Insertion et retrait de nœuds, d'usage courant dans le rendu. */
function polyfillElements(ElementProto) {
  if (notThere(ElementProto.replaceChildren)) {
    ElementProto.replaceChildren = function replaceChildren(...children) {
      while (this.firstChild) this.removeChild(this.firstChild);
      for (const node of textNodes(children)) this.appendChild(node);
    };
  }
  if (notThere(ElementProto.append)) {
    ElementProto.append = function append(...children) {
      for (const node of textNodes(children)) this.appendChild(node);
    };
  }
  if (notThere(ElementProto.prepend)) {
    ElementProto.prepend = function prepend(...children) {
      for (const node of textNodes(children)) this.insertBefore(node, this.firstChild);
    };
  }
  if (notThere(ElementProto.replaceWith)) {
    ElementProto.replaceWith = function replaceWith(...children) {
      if (!this.parentNode) return;
      for (const node of textNodes(children)) this.parentNode.insertBefore(node, this);
      this.parentNode.removeChild(this);
    };
  }
  if (notThere(ElementProto.remove)) {
    ElementProto.remove = function remove() {
      if (this.parentNode) this.parentNode.removeChild(this);
    };
  }
  if (notThere(ElementProto.toggleAttribute)) {
    ElementProto.toggleAttribute = function toggleAttribute(name, force) {
      const on = arguments.length > 1 ? !!force : !this.hasAttribute(name);
      if (on) this.setAttribute(name, '');
      else this.removeAttribute(name);
      return on;
    };
  }
}

/** Petites méthodes de collection et de chaîne ajoutées depuis ES2019. */
function polyfillBuiltins() {
  if (typeof Object.fromEntries !== 'function') {
    Object.fromEntries = (entries) => {
      const out = {};
      for (const pair of entries) out[pair[0]] = pair[1];
      return out;
    };
  }
  if (notThere(String.prototype.replaceAll)) {
    String.prototype.replaceAll = function replaceAll(search, replacement) {
      // Une chaîne littérale se remplace partout ; une expression garde son sens.
      if (typeof search === 'string') return this.split(search).join(replacement);
      return this.replace(new RegExp(search.source, `g${search.flags.replace('g', '')}`), replacement);
    };
  }
  if (notThere(Array.prototype.flat)) {
    Array.prototype.flat = function flat(depth) {
      const level = depth === undefined ? 1 : depth;
      if (level < 1) return Array.prototype.slice.call(this);
      return this.reduce((acc, item) => acc.concat(Array.isArray(item) ? item.flat(level - 1) : item), []);
    };
  }
  if (notThere(Array.prototype.flatMap)) {
    Array.prototype.flatMap = function flatMap(fn, thisArg) {
      return this.reduce((acc, item, index) => acc.concat(fn.call(thisArg, item, index, this)), []);
    };
  }
  if (notThere(Array.prototype.at)) {
    Array.prototype.at = function at(index) {
      return this[index < 0 ? this.length + index : index];
    };
  }
  if (notThere(Promise.prototype.finally)) {
    Promise.prototype.finally = function finallyFn(done) {
      return this.then(
        (value) => {
          done();
          return value;
        },
        (error) => {
          done();
          throw error;
        },
      );
    };
  }
  if (notThere(Promise.allSettled)) {
    Promise.allSettled = (items) =>
      Promise.all(
        Array.prototype.map.call(items, (item) =>
          Promise.resolve(item).then(
            (value) => ({ status: 'fulfilled', value }),
            (reason) => ({ status: 'rejected', reason }),
          ),
        ),
      );
  }
  if (notThere(root.queueMicrotask)) {
    root.queueMicrotask = (fn) => Promise.resolve().then(fn);
  }
  if (notThere(root.requestIdleCallback)) {
    root.requestIdleCallback = (fn) =>
      setTimeout(() => fn({ didTimeout: false, timeRemaining: () => 50 }), 1);
    root.cancelIdleCallback = (id) => clearTimeout(id);
  }
  if (typeof AbortController === 'function' && AbortController.prototype
    && notThere(AbortController.prototype.throwIfAborted)) {
    AbortController.prototype.throwIfAborted = function throwIfAborted() {
      if (this.signal.aborted) throw this.signal.reason;
    };
  }
}

/** Méthodes récentes dont le paquet a besoin, une fois recensées. */
function polyfillNewer() {
  if (notThere(Object.hasOwn)) {
    Object.hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
  }
  if (notThere(Array.prototype.findLast)) {
    Array.prototype.findLast = function findLast(fn, thisArg) {
      for (let i = this.length - 1; i >= 0; i -= 1) {
        if (fn.call(thisArg, this[i], i, this)) return this[i];
      }
      return undefined;
    };
  }
  if (notThere(Array.prototype.findLastIndex)) {
    Array.prototype.findLastIndex = function findLastIndex(fn, thisArg) {
      for (let i = this.length - 1; i >= 0; i -= 1) {
        if (fn.call(thisArg, this[i], i, this)) return i;
      }
      return -1;
    };
  }
  if (notThere(String.prototype.matchAll)) {
    String.prototype.matchAll = function matchAllAll(regexp) {
      const source = regexp.global ? regexp.source : `${regexp.source}`;
      const flags = regexp.flags.includes('g') ? regexp.flags : `${regexp.flags}g`;
      const expression = new RegExp(source, flags);
      const out = [];
      let match = expression.exec(this);
      while (match) {
        out.push(match);
        if (match[0] === '') expression.lastIndex += 1;
        match = expression.exec(this);
      }
      out[Symbol.iterator] = function iterator() {
        return Array.prototype[Symbol.iterator].call(out);
      };
      return out;
    };
  }
  if (notThere(String.prototype.at)) {
    String.prototype.at = function at(index) {
      return this[index < 0 ? this.length + index : index];
    };
  }
  if (notThere(String.prototype.padStart)) {
    String.prototype.padStart = function padStart(length, filler) {
      const pad = filler === undefined ? ' ' : String(filler);
      const text = String(this);
      if (text.length >= length || !pad) return text;
      const needed = length - text.length;
      return pad.repeat(Math.ceil(needed / pad.length)).slice(0, needed) + text;
    };
  }
  const ElementProto = typeof root.Element === 'function' ? root.Element.prototype : null;
  if (ElementProto && notThere(ElementProto.checkVisibility)) {
    ElementProto.checkVisibility = function checkVisibility() {
      return this.getClientRects().length > 0;
    };
  }
  if (notThere(root.structuredClone)) {
    // Les données de l'interface sont simples (objets, tableaux, dates) :
    // une copie en profondeur suffit pour les isoler.
    root.structuredClone = function structuredClone(value) {
      if (value === null || typeof value !== 'object') return value;
      if (value instanceof Date) return new Date(value.getTime());
      if (value instanceof Map) return new Map(Array.from(value, ([k, v]) => [k, root.structuredClone(v)]));
      if (value instanceof Set) return new Set(Array.from(value, (item) => root.structuredClone(item)));
      if (Array.isArray(value)) return value.map((item) => root.structuredClone(item));
      if (ArrayBuffer.isView(value)) return value.slice();
      if (value instanceof ArrayBuffer) return value.slice(0);
      const out = {};
      for (const key of Object.keys(value)) out[key] = root.structuredClone(value[key]);
      return out;
    };
  }
  if (notThere(root.crypto && root.crypto.randomUUID)) {
    const random = () => {
      const bytes = new Uint8Array(16);
      if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(bytes);
      else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.prototype.map.call(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    };
    if (!root.crypto) root.crypto = {};
    try {
      Object.defineProperty(root.crypto, 'randomUUID', { value: random, configurable: true, writable: true });
    } catch (error) {
      root.crypto.randomUUID = random;
    }
  }
  if (typeof AbortSignal === 'function' && notThere(AbortSignal.timeout)) {
    AbortSignal.timeout = (milliseconds) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new Error('timeout')), milliseconds);
      return controller.signal;
    };
  }
  if (typeof AbortSignal === 'function' && notThere(AbortSignal.any)) {
    AbortSignal.any = (signals) => {
      const controller = new AbortController();
      for (const signal of signals) {
        if (signal.aborted) {
          controller.abort(signal.reason);
          break;
        }
        signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
      }
      return controller.signal;
    };
  }
  // Tableaux : `toSorted` et compagnie gardent l'original intact.
  for (const [name, apply] of [
    ['toSorted', (list, fn) => Array.prototype.slice.call(list).sort(fn)],
    ['toReversed', (list) => Array.prototype.slice.call(list).reverse()],
    ['toSpliced', (list, start, count, ...items) => {
      const copy = Array.prototype.slice.call(list);
      copy.splice(start, count, ...items);
      return copy;
    }],
    ['with', (list, index, value) => {
      const copy = Array.prototype.slice.call(list);
      copy[index < 0 ? copy.length + index : index] = value;
      return copy;
    }],
  ]) {
    if (notThere(Array.prototype[name])) {
      Object.defineProperty(Array.prototype, name, {
        value: function toCopy(...args) {
          return apply(this, ...args);
        },
        configurable: true,
        writable: true,
      });
    }
  }
}

/** Découpage en mots et en caractères : la version locale suffit. */
function polyfillSegmentation() {
  if (typeof Intl === 'undefined') return;
  const Segmenter = function Segmenter(locale, options) {
    this.granularity = options && options.granularity;
  };
  const splitWords = (text) => {
    const out = [];
    const isWord = (ch) => /[\p{L}\p{N}_]/u.test(ch);
    let buffer = '';
    let start = 0;
    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (!buffer) {
        buffer = ch;
        start = i;
        continue;
      }
      if (isWord(ch) === isWord(buffer[buffer.length - 1])) {
        buffer += ch;
      } else {
        out.push({ segment: buffer, index: start, input: text, isWordLike: isWord(buffer[0]) });
        buffer = ch;
        start = i;
      }
    }
    if (buffer) out.push({ segment: buffer, index: start, input: text, isWordLike: isWord(buffer[0]) });
    return out;
  };
  Segmenter.prototype.segment = function segment(text) {
    const input = String(text);
    const list = this.granularity === 'word'
      ? splitWords(input)
      : Array.from(input, (ch, index) => ({ segment: ch, index, input }));
    // Un segment se parcourt : `for…of` doit fonctionner comme ailleurs.
    Object.defineProperty(list, Symbol.iterator, {
      value: function iterator() {
        return Array.prototype[Symbol.iterator].call(list);
      },
      configurable: true,
    });
    list.containing = function containing(index) {
      return list.find((entry) => index >= entry.index
        && index < entry.index + entry.segment.length) || undefined;
    };
    return list;
  };
  Segmenter.supportedLocalesOf = () => [];
  if (notThere(Intl.Segmenter)) Intl.Segmenter = Segmenter;
  if (notThere(Intl.ListFormat)) {
    const ListFormat = function ListFormat(locale, options) {
      this.type = options && options.type;
    };
    ListFormat.prototype.format = function format(items) {
      const list = Array.from(items);
      if (list.length < 2) return list.join('');
      const last = this.type === 'disjunction' ? ' ou ' : ' et ';
      return `${list.slice(0, -1).join(', ')}${last}${list[list.length - 1]}`;
    };
    ListFormat.supportedLocalesOf = () => [];
    Intl.ListFormat = ListFormat;
  }
}

/** Plusieurs éléments d'un fichier peuvent se superposer : `scrollend` aussi. */
function polyfillObservers() {
  if (notThere(root.ResizeObserver)) {
    root.ResizeObserver = class ResizeObserver {
      constructor(callback) {
        this.callback = callback;
        this.targets = new Set();
        this.timer = null;
      }

      observe(target) {
        this.targets.add(target);
        this.schedule();
      }

      unobserve(target) {
        this.targets.delete(target);
      }

      disconnect() {
        this.targets.clear();
        clearTimeout(this.timer);
      }

      schedule() {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => {
          const entries = Array.from(this.targets, (target) => ({
            target,
            contentRect: target.getBoundingClientRect(),
            borderBoxSize: [],
            contentBoxSize: [],
          }));
          this.callback(entries, this);
        }, 64);
      }
    };
  }
  if (notThere(root.IntersectionObserver)) {
    root.IntersectionObserver = class IntersectionObserver {
      constructor(callback) {
        this.callback = callback;
      }

      observe(target) {
        this.callback([{ target, isIntersecting: true, intersectionRatio: 1 }], this);
      }

      unobserve() {}

      disconnect() {}
    };
  }
}

function applyCompat(target) {
  if (!target || !target.document) return;
  // Certains paquets écrivent `globalThis` ; la page elle-même l'ignore.
  // L'alias est posé au tout début, avant le moindre module.
  if (typeof root.globalThis === 'undefined') {
    try {
      Object.defineProperty(root, 'globalThis', { value: root, configurable: true, writable: true });
    } catch (error) {
      root.globalThis = root;
    }
  }

  if (typeof target.Element === 'function') polyfillElements(target.Element.prototype);
  polyfillBuiltins();
  polyfillNewer();
  polyfillSegmentation();
  polyfillObservers();
}

applyCompat(root);
