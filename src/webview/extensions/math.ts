/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

import { Node, mergeAttributes } from '@tiptap/core';
import katex from 'katex';

function renderKatex(source: string, displayMode: boolean, target: HTMLElement): void {
  const trimmed = source.trim();
  if (!trimmed) {
    target.classList.add('math-empty');
    target.textContent = displayMode ? '(empty math block)' : '(empty)';
    return;
  }
  target.classList.remove('math-empty');
  try {
    katex.render(trimmed, target, {
      displayMode,
      throwOnError: false,
      strict: 'ignore',
      output: 'html',
    });
  } catch (error) {
    target.classList.add('math-error');
    const message = error instanceof Error ? error.message : 'Invalid LaTeX';
    target.textContent = displayMode ? `Math error: ${message}` : `[${message}]`;
  }
}

export const MathInline = Node.create({
  name: 'mathInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      src: {
        default: '',
        parseHTML: element => element.getAttribute('data-math-src') || '',
        renderHTML: attributes => ({ 'data-math-src': attributes.src }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-math-inline]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-math-inline': 'true',
        class: 'math-inline',
      }),
    ];
  },

  markdownTokenName: 'mathInline',

  parseMarkdown: (token, helpers) => {
    const src = (token.text ?? '').toString();
    return helpers.createNode('mathInline', { src }, []);
  },

  renderMarkdown: node => {
    const src = ((node.attrs?.src as string) || '').trim();
    if (!src) return '';
    return `$${src}$`;
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const span = document.createElement('span');
      span.className = 'math-inline';
      span.setAttribute('data-math-inline', 'true');
      span.setAttribute('contenteditable', 'false');

      const render = (src: string) => {
        span.innerHTML = '';
        renderKatex(src, false, span);
      };

      render((node.attrs.src as string) || '');

      const openEditor = () => {
        if (typeof getPos !== 'function') return;
        const current = (node.attrs.src as string) || '';
        showInlineMathEditor(span, current, newSrc => {
          const pos = getPos();
          if (typeof pos !== 'number') return;
          const tr = editor.state.tr.setNodeMarkup(pos, undefined, { src: newSrc });
          editor.view.dispatch(tr);
        });
      };

      span.addEventListener('mousedown', e => {
        if (typeof getPos !== 'function') return;
        const pos = getPos();
        if (typeof pos !== 'number') return;
        // Select the node so backspace/delete work, but don't preventDefault —
        // ProseMirror still needs to manage focus.
        try {
          editor.chain().setNodeSelection(pos).run();
        } catch {
          /* ignore */
        }
        e.stopPropagation();
      });

      span.addEventListener('dblclick', e => {
        e.preventDefault();
        e.stopPropagation();
        openEditor();
      });

      return {
        dom: span,
        update: updatedNode => {
          if (updatedNode.type.name !== 'mathInline') return false;
          render((updatedNode.attrs.src as string) || '');
          return true;
        },
      };
    };
  },
});

export const MathBlock = Node.create({
  name: 'mathBlock',
  group: 'block',
  content: 'text*',
  marks: '',
  code: true,
  defining: true,
  isolating: true,

  parseHTML() {
    return [
      {
        tag: 'pre[data-math-block]',
        preserveWhitespace: 'full',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'pre',
      mergeAttributes(HTMLAttributes, {
        'data-math-block': 'true',
        class: 'math-block',
      }),
      ['code', {}, 0],
    ];
  },

  markdownTokenName: 'mathBlock',

  parseMarkdown: (token, helpers) => {
    const text = (token.text ?? '').toString();
    const content = text ? [helpers.createTextNode(text)] : [];
    return helpers.createNode('mathBlock', {}, content);
  },

  renderMarkdown: (node, helpers) => {
    const body = helpers.renderChildren(node.content || [], '\n').replace(/\s+$/, '');
    return `$$\n${body}\n$$`;
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'math-block-wrapper';

      const renderEl = document.createElement('div');
      renderEl.className = 'math-block-rendered';
      renderEl.setAttribute('contenteditable', 'false');

      const sourceEl = document.createElement('pre');
      sourceEl.className = 'math-block-source';
      sourceEl.setAttribute('spellcheck', 'false');

      wrapper.appendChild(renderEl);
      wrapper.appendChild(sourceEl);

      const renderMath = () => {
        renderKatex(node.textContent || '', true, renderEl);
      };
      renderMath();

      const updateFocusState = () => {
        if (typeof getPos !== 'function') {
          return;
        }
        const pos = getPos();
        if (typeof pos !== 'number') {
          wrapper.classList.remove('editing');
          return;
        }
        const { from, to } = editor.state.selection;
        const nodeStart = pos;
        const nodeEnd = pos + node.nodeSize;
        // Strict-inside check: only treat the block as "editing" when the
        // selection is actually inside its text content, not when it's at the
        // boundary or wrapping the whole node.
        const inside = from > nodeStart && to < nodeEnd;
        wrapper.classList.toggle('editing', inside);
      };

      // Re-evaluate focus whenever selection changes.
      editor.on('selectionUpdate', updateFocusState);
      updateFocusState();

      // Clicking on the rendered preview should drop the cursor inside the
      // source so the block flips into editing mode automatically.
      renderEl.addEventListener('mousedown', e => {
        if (typeof getPos !== 'function') return;
        const pos = getPos();
        if (typeof pos !== 'number') return;
        e.preventDefault();
        const target = pos + 1;
        try {
          editor.chain().focus().setTextSelection(target).run();
        } catch {
          /* ignore */
        }
      });

      return {
        dom: wrapper,
        contentDOM: sourceEl,
        update: updatedNode => {
          if (updatedNode.type.name !== 'mathBlock') return false;
          renderMath();
          updateFocusState();
          return true;
        },
        destroy: () => {
          editor.off('selectionUpdate', updateFocusState);
        },
      };
    };
  },
});

/**
 * Lightweight inline editor popover for inline math nodes. Shown anchored to
 * the rendered KaTeX span; closes on Enter (commit), Escape (cancel), or
 * outside click.
 */
function showInlineMathEditor(
  anchor: HTMLElement,
  initialSrc: string,
  onCommit: (next: string) => void
): void {
  // Remove any existing inline editor first
  document.querySelectorAll('.math-inline-editor').forEach(el => el.remove());

  const editor = document.createElement('div');
  editor.className = 'math-inline-editor';

  const input = document.createElement('input');
  input.type = 'text';
  input.value = initialSrc;
  input.className = 'math-inline-editor-input';
  input.setAttribute('aria-label', 'Edit inline math source');

  editor.appendChild(input);
  document.body.appendChild(editor);

  // Position near anchor
  const rect = anchor.getBoundingClientRect();
  editor.style.left = `${Math.max(8, rect.left)}px`;
  editor.style.top = `${rect.bottom + 4 + window.scrollY}px`;

  input.focus();
  input.select();

  let closed = false;
  const close = (commit: boolean) => {
    if (closed) return;
    closed = true;
    if (commit) {
      const next = input.value.trim();
      if (next && next !== initialSrc) {
        onCommit(next);
      }
    }
    document.removeEventListener('mousedown', handleOutside, true);
    editor.remove();
  };

  const handleOutside = (e: MouseEvent) => {
    if (!editor.contains(e.target as HTMLElement)) {
      close(true);
    }
  };

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close(false);
    }
  });

  // Defer the outside-click listener so the opening event itself doesn't close it
  setTimeout(() => {
    document.addEventListener('mousedown', handleOutside, true);
  }, 0);
}

/**
 * Install marked tokenizers for `$...$` (inline) and `$$...$$` (block) math.
 * Mirrors the pattern used by installBlankLineLexerNormalizer — patches the
 * marked instance after the editor is created.
 */
export function installMathTokenizers(markedInstance: unknown): void {
  const inst = markedInstance as {
    use?: (config: unknown) => void;
  };
  if (typeof inst.use !== 'function') return;

  inst.use({
    extensions: [
      {
        name: 'mathBlock',
        level: 'block',
        start(src: string) {
          const idx = src.indexOf('$$');
          return idx === -1 ? undefined : idx;
        },
        tokenizer(src: string) {
          // Block math: $$ ... $$ (multiline or single-line)
          // Must start at line beginning. Allow optional leading newline after
          // opening, optional trailing newline before closing.
          const match = /^\$\$[ \t]*\n?([\s\S]+?)\n?[ \t]*\$\$(?:\n|$)/.exec(src);
          if (!match) return undefined;
          return {
            type: 'mathBlock',
            raw: match[0],
            text: match[1],
          };
        },
      },
      {
        name: 'mathInline',
        level: 'inline',
        start(src: string) {
          const idx = src.indexOf('$');
          return idx === -1 ? undefined : idx;
        },
        tokenizer(src: string) {
          // Inline math: $...$
          // Rules to avoid common false positives (currency etc.):
          //  - no whitespace immediately after opening $
          //  - no whitespace immediately before closing $
          //  - closing $ not followed by a digit (so "$5 + $10" isn't math)
          //  - no embedded newline (inline only)
          //  - allow escaped \$ inside via \\.
          const match = /^\$(?!\s|\$)((?:\\.|[^\\\n$])+?)(?<!\s)\$(?!\d)/.exec(src);
          if (!match) return undefined;
          return {
            type: 'mathInline',
            raw: match[0],
            text: match[1],
          };
        },
      },
    ],
  });
}
