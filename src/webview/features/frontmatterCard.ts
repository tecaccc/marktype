/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

import { Editor } from '@tiptap/core';
import { t } from '../i18n';

const CARD_ID = 'frontmatter-card';
const CODEBLOCK_HIDDEN_CLASS = 'frontmatter-hidden-block';

let cardElement: HTMLElement | null = null;
let lastSignature = '';

interface FrontmatterEntry {
  key: string;
  value: string;
}

/**
 * Parse simple top-level YAML key/value pairs.
 *
 * Handles the common frontmatter shapes:
 *   - `key: value`
 *   - `key:` followed by indented bullet list (`  - item`) → rendered as `[a, b]`
 *   - `key: [a, b]` → rendered as `[a, b]`
 *   - Quoted values are de-quoted.
 *
 * Nested objects fall back to the raw text. We intentionally avoid pulling in
 * a real YAML parser to keep the webview bundle small.
 */
function parseFrontmatter(yaml: string): FrontmatterEntry[] {
  const entries: FrontmatterEntry[] = [];
  const rawLines = yaml.split(/\r?\n/);
  let i = 0;
  while (i < rawLines.length) {
    const line = rawLines[i];
    if (!line || /^---\s*$/.test(line) || /^\s*$/.test(line) || /^\s*#/.test(line)) {
      i++;
      continue;
    }
    // Only handle top-level keys (no leading indent)
    const match = line.match(/^([A-Za-z0-9_.-]+)\s*:(.*)$/);
    if (!match) {
      i++;
      continue;
    }
    const key = match[1];
    let value = match[2].trim();

    // Strip trailing inline comments and surrounding quotes
    value = value.replace(/\s+#.*$/, '');
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }

    // Block-style list: key: \n  - a\n  - b
    if (value === '') {
      const items: string[] = [];
      let j = i + 1;
      while (j < rawLines.length) {
        const next = rawLines[j];
        const bullet = next.match(/^\s+-\s+(.*)$/);
        if (!bullet) break;
        items.push(bullet[1].trim().replace(/^['"]|['"]$/g, ''));
        j++;
      }
      if (items.length > 0) {
        value = `[${items.join(', ')}]`;
        i = j;
        entries.push({ key, value });
        continue;
      }
    }

    entries.push({ key, value });
    i++;
  }
  return entries;
}

interface FrontmatterCodeBlock {
  pos: number;
  nodeSize: number;
  yamlText: string;
}

function findLeadingFrontmatterBlock(editor: Editor): FrontmatterCodeBlock | null {
  const doc = editor.state.doc;
  if (doc.childCount === 0) return null;
  const first = doc.firstChild;
  if (!first || first.type.name !== 'codeBlock') return null;

  const language = (first.attrs.language as string | null | undefined) ?? '';
  if (language && !/^ya?ml$/i.test(language)) return null;

  const text = first.textContent ?? '';
  // Wrapped frontmatter from the host begins with `---` and ends with `---`.
  if (!/^---\s*\r?\n/.test(text)) return null;
  if (!/\r?\n---\s*$/.test(text.trimEnd())) return null;

  return {
    pos: 0,
    nodeSize: first.nodeSize,
    yamlText: text,
  };
}

function ensureCardElement(): HTMLElement {
  if (cardElement && document.body.contains(cardElement)) return cardElement;

  const card = document.createElement('section');
  card.id = CARD_ID;
  card.className = 'frontmatter-card';
  card.setAttribute('role', 'group');
  card.setAttribute('aria-label', 'Document metadata');
  cardElement = card;
  return card;
}

function placeCard(card: HTMLElement): void {
  const editorContainer = document.querySelector('#editor');
  if (!editorContainer || !editorContainer.parentElement) return;
  // Insert (or move) right above the editor. The toolbar is also a sibling
  // earlier in the parent, so the card lands between toolbar and editor.
  if (card.nextSibling !== editorContainer) {
    editorContainer.parentElement.insertBefore(card, editorContainer);
  }
}

function renderCardContents(card: HTMLElement, entries: FrontmatterEntry[]): void {
  card.innerHTML = '';
  const title = document.createElement('div');
  title.className = 'frontmatter-card-title';
  title.textContent = t('frontmatterCard.title', 'Metadata');
  card.appendChild(title);

  const list = document.createElement('dl');
  list.className = 'frontmatter-card-list';
  for (const entry of entries) {
    const dt = document.createElement('dt');
    dt.textContent = entry.key;
    const dd = document.createElement('dd');
    dd.textContent = entry.value;
    list.appendChild(dt);
    list.appendChild(dd);
  }
  card.appendChild(list);
}

function markCodeBlockHidden(editor: Editor, block: FrontmatterCodeBlock | null): void {
  const root = editor.view?.dom as HTMLElement | undefined;
  if (!root) return;
  // Clear any previously-marked block first.
  root.querySelectorAll(`.${CODEBLOCK_HIDDEN_CLASS}`).forEach(node => {
    node.classList.remove(CODEBLOCK_HIDDEN_CLASS);
  });
  if (!block) return;
  const firstChild = root.firstElementChild as HTMLElement | null;
  if (firstChild && firstChild.tagName === 'PRE') {
    firstChild.classList.add(CODEBLOCK_HIDDEN_CLASS);
  }
}

function removeCard(): void {
  if (cardElement && cardElement.parentElement) {
    cardElement.parentElement.removeChild(cardElement);
  }
  cardElement = null;
  lastSignature = '';
}

/**
 * Refresh the frontmatter card based on current editor content and setting.
 * Idempotent — safe to call on every editor update.
 */
export function refreshFrontmatterCard(editor: Editor, enabled: boolean): void {
  if (!enabled) {
    markCodeBlockHidden(editor, null);
    removeCard();
    document.body.classList.remove('has-frontmatter-card');
    return;
  }

  const block = findLeadingFrontmatterBlock(editor);
  if (!block) {
    markCodeBlockHidden(editor, null);
    removeCard();
    document.body.classList.remove('has-frontmatter-card');
    return;
  }

  const entries = parseFrontmatter(block.yamlText);
  if (entries.length === 0) {
    markCodeBlockHidden(editor, null);
    removeCard();
    document.body.classList.remove('has-frontmatter-card');
    return;
  }

  const signature = entries.map(e => `${e.key}=${e.value}`).join('\n');
  const card = ensureCardElement();
  placeCard(card);
  if (signature !== lastSignature) {
    renderCardContents(card, entries);
    lastSignature = signature;
  }
  markCodeBlockHidden(editor, block);
  document.body.classList.add('has-frontmatter-card');
}
