/* The site reads the public edition files directly; it has no build or API service. */
(function (root) {
  'use strict';

  function isSafeUrl(value) {
    const url = String(value || '');
    if (!url || /[\u0000-\u0020\u007f\\]/.test(url) || url.startsWith('//')) return false;
    const scheme = url.match(/^([a-z][a-z\d+.-]*):/i);
    return !scheme || /^(https?)$/i.test(scheme[1]);
  }

  function isValidDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
    const date = new Date(value + 'T12:00:00Z');
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function createMarkdownRenderer(MarkdownIt) {
    let factory = MarkdownIt || root.markdownit;
    if (!factory && typeof require === 'function') factory = require('./markdown-it.min.js');
    if (!factory) throw new Error('The Markdown reader could not be loaded.');
    const renderer = factory({ html: false, linkify: false, typographer: false, breaks: false });
    const defaultValidate = renderer.validateLink.bind(renderer);
    renderer.validateLink = function (url) { return defaultValidate(url) && isSafeUrl(url); };
    const defaultLink = renderer.renderer.rules.link_open || function (tokens, index, options, env, self) { return self.renderToken(tokens, index, options); };
    renderer.renderer.rules.link_open = function (tokens, index, options, env, self) {
      const token = tokens[index];
      const href = token.attrGet('href') || '';
      if (/^https?:/i.test(href)) {
        token.attrSet('target', '_blank');
        token.attrSet('rel', 'noopener noreferrer');
      }
      return defaultLink(tokens, index, options, env, self);
    };
    const defaultImage = renderer.renderer.rules.image;
    renderer.renderer.rules.image = function (tokens, index, options, env, self) {
      tokens[index].attrSet('loading', 'lazy');
      tokens[index].attrSet('decoding', 'async');
      tokens[index].attrSet('referrerpolicy', 'no-referrer');
      return defaultImage(tokens, index, options, env, self);
    };
    return renderer;
  }

  if (typeof module === 'object' && module.exports) module.exports = { createMarkdownRenderer, isSafeUrl, isValidDate };
  if (!root.document) return;

  const document = root.document;
  const byId = function (id) { return document.getElementById(id); };
  const siteRoot = new URL('.', root.location.href);
  const state = { dates: [], selected: '', source: 'all', sections: [], controller: null, request: 0, renderer: null };
  const dateFormat = new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const shortDateFormat = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' });

  function formatDate(date, short) { return (short ? shortDateFormat : dateFormat).format(new Date(date + 'T12:00:00Z')); }
  function normalized(value) { return value.toLocaleLowerCase().replace(/\s+/g, ' ').trim(); }
  function searchableText(element) { return normalized(element.textContent + ' ' + Array.from(element.querySelectorAll('img')).map(function (image) { return image.alt; }).join(' ')); }
  function editionUrl(date) { const url = new URL(siteRoot); url.searchParams.set('date', date); return url; }
  function showStatus(message, error) {
    const status = byId('status');
    status.textContent = message;
    status.hidden = !message;
    status.classList.toggle('is-error', Boolean(error));
  }

  function initializeTheme() {
    let theme = 'system';
    try { theme = root.localStorage.getItem('digest-theme') || theme; } catch (_) { /* Storage may be unavailable in private browsing. */ }
    if (!['system', 'light', 'dark'].includes(theme)) theme = 'system';
    function apply(value) {
      document.documentElement.dataset.theme = value;
      byId('theme').value = value;
    }
    apply(theme);
    byId('theme').addEventListener('change', function (event) {
      apply(event.target.value);
      try { root.localStorage.setItem('digest-theme', event.target.value); } catch (_) { /* The choice still works for this visit. */ }
    });
  }

  function renderArchive() {
    const list = byId('edition-list');
    list.replaceChildren();
    if (!state.dates.length) {
      const item = document.createElement('li');
      item.className = 'muted';
      item.textContent = 'No recent editions listed.';
      list.append(item);
      return;
    }
    state.dates.forEach(function (date, index) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = editionUrl(date).href;
      link.dataset.date = date;
      const label = document.createElement('span');
      label.textContent = formatDate(date, true);
      const detail = document.createElement('span');
      detail.className = 'edition-detail';
      detail.textContent = index === 0 ? 'Latest' : date.slice(0, 4);
      link.append(label, detail);
      if (date === state.selected) link.setAttribute('aria-current', 'page');
      link.addEventListener('click', function (event) {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        navigate(date);
      });
      item.append(link);
      list.append(item);
    });
  }

  function sectionItemCount(section) {
    return Array.from(section.children).reduce(function (count, element) {
      if (element.matches('ul, ol')) return count + element.children.length;
      if (element.matches('p, blockquote, pre, table')) return count + 1;
      return count;
    }, 0);
  }

  function buildEdition(markdown) {
    const template = document.createElement('template');
    template.innerHTML = state.renderer.render(markdown);
    const digest = byId('digest');
    digest.replaceChildren();
    state.sections = [];
    state.source = 'all';
    byId('search').value = '';
    const intro = document.createElement('div');
    intro.className = 'edition-intro prose';
    intro.dataset.kind = 'intro';
    let current = intro;
    digest.append(intro);
    const notes = document.createElement('details');
    notes.className = 'selection-notes prose';
    const notesSummary = document.createElement('summary');
    notesSummary.textContent = 'Selection notes';
    notes.append(notesSummary);

    Array.from(template.content.childNodes).forEach(function (node) {
      if (node.nodeType !== 1) { current.append(node); return; }
      if (node.matches('h1')) return;
      if (node.matches('h2')) {
        const title = node.textContent.trim();
        const highlight = /today[’']s highlights/i.test(title);
        current = document.createElement('section');
        current.className = (highlight ? 'highlights' : 'source-section') + ' prose';
        const id = 'section-' + state.sections.length;
        node.id = id;
        current.setAttribute('aria-labelledby', id);
        current.dataset.kind = highlight ? 'highlights' : 'source';
        current.append(node);
        digest.append(current);
        state.sections.push({ id: id, title: title, element: current, highlight: highlight, count: 0 });
      } else if (node.matches('p') && /^🗑️?/.test(node.textContent.trim())) {
        notes.append(node);
      } else {
        current.append(node);
      }
    });
    if (!intro.textContent.trim()) intro.remove();
    if (notes.children.length > 1) digest.append(notes);
    digest.querySelectorAll('p, li, blockquote').forEach(function (element) {
      if (/^⚠️?/.test(element.textContent.trim())) element.classList.add('source-warning');
    });
    state.sections.forEach(function (section) {
      section.count = sectionItemCount(section.element);
      if (!section.highlight) {
        const badge = document.createElement('span');
        badge.className = 'section-count';
        badge.textContent = String(section.count);
        badge.setAttribute('aria-label', section.count + ' entries');
        section.element.querySelector('h2').append(badge);
      }
    });
    renderFilters();
    applyFilters();
  }

  function renderFilters() {
    const filters = byId('source-filters');
    filters.replaceChildren();
    const sources = state.sections.filter(function (section) { return !section.highlight; });
    const entries = [{ id: 'all', title: 'All sources', count: null }].concat(sources);
    entries.forEach(function (source) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'source-filter';
      button.dataset.source = source.id;
      button.setAttribute('aria-pressed', source.id === state.source ? 'true' : 'false');
      button.textContent = source.title;
      if (source.count !== null) {
        const count = document.createElement('span');
        count.textContent = String(source.count);
        button.append(count);
      }
      button.addEventListener('click', function () { state.source = source.id; applyFilters(); });
      filters.append(button);
    });
    byId('reading-controls').hidden = false;
  }

  function filterSection(section, query) {
    const children = Array.from(section.children);
    const headings = [];
    let visible = 0;
    children.forEach(function (element) {
      if (element.matches('h1, h2, h3, h4, h5, h6')) {
        const level = Number(element.tagName.slice(1));
        while (headings.length && headings[headings.length - 1].level >= level) headings.pop();
        headings.push({ level: level, matches: normalized(element.textContent).includes(query) });
        element.hidden = false;
        return;
      }
      const needle = headings.some(function (heading) { return heading.matches; }) ? '' : query;
      if (element.matches('ul, ol')) {
        let matchingItems = 0;
        Array.from(element.children).forEach(function (item) {
          item.hidden = Boolean(needle) && !searchableText(item).includes(needle);
          if (!item.hidden) matchingItems += 1;
        });
        element.hidden = matchingItems === 0;
        visible += matchingItems;
      } else {
        element.hidden = Boolean(needle) && !searchableText(element).includes(needle);
        if (!element.hidden && (element.textContent.trim() || element.querySelector('img'))) visible += 1;
      }
    });
    children.forEach(function (element, index) {
      if (!element.matches('h3, h4, h5, h6')) return;
      const level = Number(element.tagName.slice(1));
      let hasContent = false;
      for (let next = index + 1; next < children.length; next += 1) {
        const sibling = children[next];
        if (/^H[1-6]$/.test(sibling.tagName) && Number(sibling.tagName.slice(1)) <= level) break;
        if (!/^H[1-6]$/.test(sibling.tagName) && !sibling.hidden) hasContent = true;
      }
      element.hidden = !hasContent;
    });
    return visible;
  }

  function applyFilters() {
    const query = normalized(byId('search').value);
    let visibleEntries = 0;
    let visibleSources = 0;
    state.sections.forEach(function (section) {
      const allowed = state.source === 'all' || section.id === state.source;
      const matches = filterSection(section.element, query);
      section.element.hidden = !allowed || matches === 0;
      if (!section.element.hidden) { visibleEntries += matches; if (!section.highlight) visibleSources += 1; }
    });
    const intro = byId('digest').querySelector('.edition-intro');
    let introMatches = 0;
    if (intro) {
      introMatches = filterSection(intro, query);
      intro.hidden = state.source !== 'all' || introMatches === 0;
    }
    const notes = byId('digest').querySelector('.selection-notes');
    if (notes) notes.hidden = state.source !== 'all' || (Boolean(query) && !normalized(notes.textContent).includes(query));
    byId('source-filters').querySelectorAll('button').forEach(function (button) { button.setAttribute('aria-pressed', button.dataset.source === state.source ? 'true' : 'false'); });
    const filtering = Boolean(query) || state.source !== 'all';
    byId('filter-summary').textContent = filtering ? visibleEntries + ' matching ' + (visibleEntries === 1 ? 'entry' : 'entries') + ' · ' + visibleSources + (visibleSources === 1 ? ' source' : ' sources') : 'Search and source filters apply to this edition.';
    byId('no-results').hidden = !filtering || visibleEntries > 0 || (state.source === 'all' && introMatches > 0) || (notes && !notes.hidden);
  }

  async function loadEdition(date) {
    if (!isValidDate(date)) { showStatus('Choose a valid edition date in YYYY-MM-DD format.', true); return; }
    if (state.controller) state.controller.abort();
    const controller = new AbortController();
    state.controller = controller;
    const request = ++state.request;
    state.selected = date;
    byId('edition-date').value = date;
    byId('edition-label').textContent = formatDate(date);
    document.title = 'Morning Digest · ' + date + ' — Bio × AI';
    renderArchive();
    byId('digest').replaceChildren();
    byId('reading-controls').hidden = true;
    byId('no-results').hidden = true;
    byId('markdown-link').hidden = true;
    byId('digest').setAttribute('aria-busy', 'true');
    showStatus('Loading ' + formatDate(date) + '…');
    try {
      const response = await root.fetch(new URL('editions/' + date + '.md', siteRoot), { signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 404 ? 'There is no published edition for this date. Try a recent edition or the full archive.' : 'This edition could not be loaded. Please try again.');
      const markdown = await response.text();
      if (request !== state.request) return;
      if (!markdown.trim()) { showStatus('This edition is empty. Choose another date.'); return; }
      buildEdition(markdown);
      const original = byId('markdown-link');
      original.href = 'https://github.com/JoJoTsui/morning-digest/blob/main/editions/' + date + '.md';
      original.target = '_blank';
      original.rel = 'noopener noreferrer';
      original.hidden = false;
      showStatus('');
    } catch (error) {
      if (request !== state.request || error.name === 'AbortError') return;
      showStatus(error.message || 'This edition could not be loaded. Please try again.', true);
    } finally {
      if (request === state.request) byId('digest').setAttribute('aria-busy', 'false');
    }
  }

  function navigate(date) {
    if (!isValidDate(date)) { showStatus('Choose a valid edition date.', true); return; }
    root.history.pushState({ date: date }, '', editionUrl(date));
    loadEdition(date);
  }

  function requestedDate() { return new URL(root.location.href).searchParams.get('date'); }

  async function start() {
    initializeTheme();
    byId('date-form').addEventListener('submit', function (event) { event.preventDefault(); navigate(byId('edition-date').value); });
    byId('search').addEventListener('input', applyFilters);
    document.addEventListener('keydown', function (event) {
      const target = event.target;
      if (event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !byId('reading-controls').hidden && !target.matches('input, textarea, select') && !target.isContentEditable) {
        event.preventDefault();
        byId('search').focus();
      }
    });
    root.addEventListener('popstate', function () { const date = requestedDate() || state.dates[0]; if (date) loadEdition(date); });
    try { state.renderer = createMarkdownRenderer(); } catch (error) { showStatus(error.message, true); return; }
    let feedError = false;
    try {
      const response = await root.fetch(new URL('feed.xml', siteRoot));
      if (!response.ok) throw new Error('Feed unavailable');
      const xml = new DOMParser().parseFromString(await response.text(), 'application/xml');
      if (xml.querySelector('parsererror')) throw new Error('Invalid feed');
      state.dates = Array.from(new Set(Array.from(xml.querySelectorAll('item > guid')).map(function (guid) { return guid.textContent.trim(); }).filter(isValidDate))).sort().reverse().slice(0, 30);
    } catch (_) { feedError = true; }
    renderArchive();
    const requested = requestedDate();
    if (requested !== null && !isValidDate(requested)) { showStatus('This edition link has an invalid date. Choose a date or open a recent edition.', true); return; }
    const date = requested || state.dates[0];
    if (!date) { showStatus(feedError ? 'Recent editions could not be loaded. Enter an edition date above, or browse the full archive.' : 'No editions have been published yet. Check back after the next digest.'); return; }
    await loadEdition(date);
  }

  start();
})(typeof globalThis !== 'undefined' ? globalThis : this);
