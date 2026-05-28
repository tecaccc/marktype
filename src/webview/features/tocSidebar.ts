/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

import { Editor } from '@tiptap/core';
import { buildOutlineFromEditor } from '../utils/outline';
import { scrollToHeading } from '../utils/scrollToHeading';
import { t } from '../i18n';

export type TocSidebarSide = 'left' | 'right';

const SIDEBAR_ID = 'toc-sidebar';
const BODY_VISIBLE_CLASS_PREFIX = 'has-toc-sidebar-';

let sidebarElement: HTMLElement | null = null;
let currentSide: TocSidebarSide = 'left';
let isVisible = false;
let renderHandle: number | null = null;
let updateListenerAttached = false;
let attachedEditor: Editor | null = null;

function ensureSidebarElement(): HTMLElement {
  if (sidebarElement && document.body.contains(sidebarElement)) return sidebarElement;

  const aside = document.createElement('aside');
  aside.id = SIDEBAR_ID;
  aside.className = `toc-sidebar toc-sidebar-${currentSide}`;
  aside.setAttribute('role', 'navigation');
  aside.setAttribute('aria-label', 'Document outline');

  const header = document.createElement('div');
  header.className = 'toc-sidebar-header';

  const title = document.createElement('h2');
  title.className = 'toc-sidebar-title';
  title.textContent = t('tocSidebar.title', 'Document Outline');
  header.appendChild(title);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'toc-sidebar-close';
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'Close outline');
  closeBtn.title = 'Close';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('mousedown', e => e.preventDefault());
  closeBtn.addEventListener('click', () => {
    hideTocSidebar();
  });
  header.appendChild(closeBtn);

  const listContainer = document.createElement('div');
  listContainer.className = 'toc-sidebar-list';
  listContainer.setAttribute('role', 'list');

  aside.appendChild(header);
  aside.appendChild(listContainer);

  document.body.appendChild(aside);
  sidebarElement = aside;
  return aside;
}

function clearBodyClasses(): void {
  document.body.classList.remove(
    `${BODY_VISIBLE_CLASS_PREFIX}left`,
    `${BODY_VISIBLE_CLASS_PREFIX}right`
  );
}

function applyBodyClass(): void {
  clearBodyClasses();
  if (isVisible) {
    document.body.classList.add(`${BODY_VISIBLE_CLASS_PREFIX}${currentSide}`);
  }
}

function applySideClass(aside: HTMLElement): void {
  aside.classList.remove('toc-sidebar-left', 'toc-sidebar-right');
  aside.classList.add(`toc-sidebar-${currentSide}`);
}

function renderList(editor: Editor, container: HTMLElement): void {
  container.innerHTML = '';
  const outline = buildOutlineFromEditor(editor);

  if (outline.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'toc-sidebar-empty';
    const p = document.createElement('p');
    p.textContent = t('tocSidebar.empty', 'No headings yet.');
    const hint = document.createElement('p');
    hint.className = 'toc-sidebar-empty-hint';
    hint.textContent = t('tocSidebar.emptyHint', 'Add a # Heading to see your document outline.');
    empty.appendChild(p);
    empty.appendChild(hint);
    container.appendChild(empty);
    return;
  }

  outline.forEach(entry => {
    const item = document.createElement('button');
    item.className = `toc-sidebar-item toc-sidebar-level-${entry.level}`;
    item.type = 'button';
    item.setAttribute('role', 'listitem');
    item.setAttribute('data-pos', String(entry.pos));

    const text = document.createElement('span');
    text.className = 'toc-sidebar-item-text';
    text.textContent = entry.text || '(Untitled)';
    item.appendChild(text);

    // Don't blur the editor on mousedown — sidebar should feel like reading
    // assistance, not focus-stealing UI.
    item.addEventListener('mousedown', e => e.preventDefault());
    item.addEventListener('click', () => {
      scrollToHeading(editor, entry.pos);
    });

    container.appendChild(item);
  });
}

function scheduleRender(editor: Editor): void {
  if (!isVisible) return;
  if (renderHandle !== null) window.cancelAnimationFrame(renderHandle);
  renderHandle = window.requestAnimationFrame(() => {
    renderHandle = null;
    const aside = ensureSidebarElement();
    const list = aside.querySelector('.toc-sidebar-list') as HTMLElement | null;
    if (list) renderList(editor, list);
  });
}

function attachEditorUpdates(editor: Editor): void {
  if (updateListenerAttached && attachedEditor === editor) return;
  if (attachedEditor && attachedEditor !== editor) {
    detachEditorUpdates();
  }
  attachedEditor = editor;
  editor.on('update', () => scheduleRender(editor));
  updateListenerAttached = true;
}

function detachEditorUpdates(): void {
  // TipTap exposes `.off` for handlers passed by reference; we rely on editor
  // destruction to fully clean up. For mode switches we leave the listener
  // attached — it no-ops while `isVisible` is false.
  updateListenerAttached = false;
  attachedEditor = null;
}

export function showTocSidebar(editor: Editor, side: TocSidebarSide): void {
  currentSide = side;
  const aside = ensureSidebarElement();
  applySideClass(aside);
  isVisible = true;
  applyBodyClass();
  aside.classList.add('visible');
  attachEditorUpdates(editor);
  scheduleRender(editor);
}

export function hideTocSidebar(): void {
  isVisible = false;
  if (sidebarElement) {
    sidebarElement.classList.remove('visible');
  }
  clearBodyClasses();
}

export function isTocSidebarVisible(): boolean {
  return isVisible;
}

export function getTocSidebarSide(): TocSidebarSide {
  return currentSide;
}

export function toggleTocSidebar(editor: Editor, side: TocSidebarSide): void {
  if (isVisible && currentSide === side) {
    hideTocSidebar();
  } else {
    showTocSidebar(editor, side);
  }
}

/**
 * Called when the display-mode setting changes. If the sidebar is currently
 * showing but the new mode isn't a sidebar (or is the other side), this
 * keeps state coherent.
 */
export function applyTocDisplayMode(
  editor: Editor,
  mode: 'overlay' | 'sidebarLeft' | 'sidebarRight'
): void {
  if (mode === 'overlay') {
    if (isVisible) hideTocSidebar();
    return;
  }
  const newSide: TocSidebarSide = mode === 'sidebarLeft' ? 'left' : 'right';
  if (isVisible) {
    // Live-switch sides without forcing the user to re-open.
    showTocSidebar(editor, newSide);
  } else {
    currentSide = newSide;
  }
}
