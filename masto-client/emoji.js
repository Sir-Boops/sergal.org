(() => {
  const draft = document.querySelector('#draft');
  const list = document.querySelector('#emojiSuggestions');
  const shortcode = /^[a-z0-9_+-]+$/i;
  const catalogues = new Map();
  let matches = [];
  let selected = -1;
  let dismissed = null;
  let composing = false;

  function currentCode() {
    if (draft.selectionStart !== draft.selectionEnd) return null;
    const caret = draft.selectionStart;
    const prefix = /(?:^|[\s([{“‘"']):([a-z0-9_+-]+)$/i.exec(draft.value.slice(0, caret));
    if (!prefix) return null;

    const start = caret - prefix[1].length - 1;
    const suffix = /^[a-z0-9_+-]*:?/i.exec(draft.value.slice(caret))[0];
    const end = caret + suffix.length;
    return {start, end, query: prefix[1].toLowerCase(), key: start + ':' + prefix[1]};
  }

  function loadCatalogue(key, load) {
    const cached = catalogues.get(key);
    if (cached && !(cached.retryAfter && Date.now() >= cached.retryAfter)) return cached.entries;
    const catalogue = {entries: []};
    catalogues.set(key, catalogue);
    Promise.resolve().then(load).then(entries => {
      catalogue.entries = entries;
      refresh();
    }).catch(() => {
      catalogue.retryAfter = Date.now() + 30_000;
    });
    return catalogue.entries;
  }

  async function standardEmoji() {
    const response = await fetch('emoji-shortcodes.json?v=1');
    if (!response.ok) throw Error('Emoji list unavailable');
    const rows = await response.json();
    return rows.map(([code, symbol]) => ({code, symbol, text: symbol, custom: false}));
  }

  async function serverEmoji(origin) {
    const {data} = await request(origin, '/api/v1/custom_emojis');
    if (!Array.isArray(data)) throw Error('Server emoji list unavailable');
    return data.flatMap(emoji => {
      if (!emoji?.visible_in_picker || typeof emoji.shortcode !== 'string' ||
          !shortcode.test(emoji.shortcode)) return [];
      const image = safeURL(emoji.static_url) || safeURL(emoji.url);
      return [{code: emoji.shortcode, image, text: ':' + emoji.shortcode + ':', custom: true}];
    });
  }

  function close() {
    list.hidden = true;
    list.replaceChildren();
    draft.removeAttribute('aria-activedescendant');
    matches = [];
    selected = -1;
  }

  function select(index) {
    if (selected >= 0) list.children[selected].setAttribute('aria-selected', 'false');
    selected = index;
    if (index < 0) {
      draft.removeAttribute('aria-activedescendant');
      return;
    }
    const option = list.children[index];
    option.setAttribute('aria-selected', 'true');
    draft.setAttribute('aria-activedescendant', option.id);
    option.scrollIntoView({block: 'nearest'});
  }

  function refresh() {
    if (composing || document.activeElement !== draft || draft.matches(':disabled')) return close();
    // Load the server catalogue as soon as the composer is focused.
    const origin = me && accountSession?.origin;
    const custom = origin ? loadCatalogue(origin, () => serverEmoji(origin)) : [];

    const token = currentCode();
    if (!token || dismissed === token.key) return close();
    const standard = loadCatalogue('standard', standardEmoji);
    const found = new Map();
    for (const entry of [...custom, ...standard]) {
      const code = entry.code.toLowerCase();
      const position = code.indexOf(token.query);
      if (position < 0 || found.has(code)) continue;
      if (draft.value.length - (token.end - token.start) + entry.text.length <= draft.maxLength) {
        found.set(code, {entry, exact: code === token.query, prefix: position === 0});
      }
    }

    const next = [...found.values()]
      .sort((a, b) => Number(b.exact) - Number(a.exact) ||
        Number(b.entry.custom) - Number(a.entry.custom) ||
        Number(b.prefix) - Number(a.prefix) ||
        a.entry.code.localeCompare(b.entry.code))
      .map(({entry}) => entry);
    if (!next.length) return close();
    if (matches.length === next.length && matches.every((entry, i) => entry === next[i])) return;

    const active = matches[selected];
    matches = next;
    selected = -1;
    const fragment = document.createDocumentFragment();
    matches.forEach((entry, index) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.tabIndex = -1;
      option.id = 'emoji-option-' + index;
      option.dataset.emojiIndex = String(index);
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');

      const preview = document.createElement('span');
      preview.className = 'emoji-preview';
      preview.setAttribute('aria-hidden', 'true');
      if (entry.image) {
        const image = document.createElement('img');
        image.alt = '';
        image.loading = 'lazy';
        image.decoding = 'async';
        image.referrerPolicy = 'no-referrer';
        image.src = entry.image;
        preview.append(image);
      } else {
        preview.textContent = entry.symbol || '';
      }

      const label = document.createElement('span');
      label.textContent = ':' + entry.code + ':';
      option.append(preview, label);
      fragment.append(option);
    });
    list.replaceChildren(fragment);
    list.hidden = false;
    list.scrollTop = 0;
    select(matches.indexOf(active));
  }

  function complete(index) {
    const token = currentCode();
    const entry = matches[index];
    if (!token || !entry) return;
    const length = draft.value.length - (token.end - token.start) + entry.text.length;
    if (length > draft.maxLength) return;
    const text = entry.text + (length < draft.maxLength && token.end === draft.value.length ? ' ' : '');
    draft.setRangeText(text, token.start, token.end, 'end');
    close();
    draft.focus({preventScroll: true});
    draft.dispatchEvent(new Event('input', {bubbles: true}));
  }

  draft.addEventListener('input', event => {
    dismissed = null;
    if (event.isComposing) close();
    else refresh();
  });
  draft.addEventListener('compositionstart', () => {
    composing = true;
    close();
  });
  draft.addEventListener('compositionend', () => {
    composing = false;
    refresh();
  });
  draft.addEventListener('focus', refresh);
  draft.addEventListener('click', refresh);
  draft.addEventListener('selectionchange', refresh);
  draft.addEventListener('blur', event => {
    if (!list.contains(event.relatedTarget)) close();
  });
  draft.addEventListener('keydown', event => {
    if (list.hidden || event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const offset = event.key === 'ArrowDown' ? 1 : -1;
      const index = selected < 0 && offset < 0 ? matches.length - 1
        : (selected + offset + matches.length) % matches.length;
      select(index);
    } else if ((event.key === 'Enter' || event.key === 'Tab') && selected >= 0) {
      event.preventDefault();
      complete(selected);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      dismissed = currentCode()?.key;
      close();
    }
  });

  // Keep the caret and on-screen keyboard in place when tapping a suggestion.
  list.addEventListener('mousedown', event => event.preventDefault());
  list.addEventListener('click', event => {
    const option = event.target.closest('[data-emoji-index]');
    if (option) complete(Number(option.dataset.emojiIndex));
  });
  document.addEventListener('pointerdown', event => {
    if (event.target !== draft && !list.contains(event.target)) close();
  });
})();
