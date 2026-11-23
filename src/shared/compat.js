/**
 * NemesisWorkspace — raccord pour les moteurs anciens.
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

export function applyCompat(target = root) {
  if (!target || !target.document) return;
  polyfillElements(target.Element.prototype);
  polyfillBuiltins();
  polyfillSegmentation();
  polyfillObservers();
}

applyCompat();
