/**
 * Copyright (c) 2025-2026 Concret.io
 *
 * Licensed under the MIT License. See LICENSE file in the project root for details.
 */

/**
 * Mermaid Full-Screen Preview Modal
 *
 * Opens an already-rendered Mermaid SVG in a full-screen overlay with
 * wheel-to-zoom (centered on the cursor) and drag-to-pan, so large diagrams
 * (e.g. wide sequence diagrams) stay legible instead of being shrunk to fit
 * the inline container.
 */

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const ZOOM_STEP = 1.2; // multiplicative step for buttons / wheel

/**
 * Show a full-screen, zoomable/pannable preview of a rendered Mermaid diagram.
 *
 * @param svgMarkup The SVG string produced by `mermaid.render` (innerHTML of
 *                  the inline `.mermaid-render` element).
 */
export function showMermaidPreview(svgMarkup: string): void {
  if (!svgMarkup.trim()) return;

  // Overlay
  const overlay = document.createElement('div');
  overlay.className = 'mermaid-preview-overlay';

  // Viewport clips the (potentially huge) transformed content.
  const viewport = document.createElement('div');
  viewport.className = 'mermaid-preview-viewport';

  // Content holds the SVG. Panning uses a CSS transform; zooming resizes the
  // SVG itself (below) so the vector stays crisp instead of being a scaled
  // bitmap (CSS `transform: scale()` would rasterize once at 1x and blur).
  const content = document.createElement('div');
  content.className = 'mermaid-preview-content';
  content.innerHTML = svgMarkup;

  const svg = content.querySelector('svg') as SVGSVGElement | null;

  // Determine the diagram's natural pixel size. mermaid's `useMaxWidth` adds an
  // inline `max-width`/`width:100%`, so prefer the viewBox for true dimensions.
  let naturalW = 1;
  let naturalH = 1;
  if (svg) {
    const vb = svg.viewBox?.baseVal;
    if (vb && vb.width && vb.height) {
      naturalW = vb.width;
      naturalH = vb.height;
    } else {
      const r = svg.getBoundingClientRect();
      naturalW = r.width || 1;
      naturalH = r.height || 1;
    }
    // Drop mermaid's responsive sizing; we drive width/height explicitly.
    svg.style.maxWidth = 'none';
    svg.removeAttribute('width');
    svg.removeAttribute('height');
  }

  viewport.appendChild(content);

  // Toolbar (zoom controls + close)
  const toolbar = document.createElement('div');
  toolbar.className = 'mermaid-preview-toolbar';
  const zoomOutBtn = makeButton('−', 'Zoom out');
  const zoomLabel = document.createElement('span');
  zoomLabel.className = 'mermaid-preview-zoom-label';
  const zoomInBtn = makeButton('+', 'Zoom in');
  const resetBtn = makeButton('Reset', 'Reset zoom');
  const closeBtn = makeButton('×', 'Close (Esc)');
  closeBtn.classList.add('mermaid-preview-close');
  toolbar.append(zoomOutBtn, zoomLabel, zoomInBtn, resetBtn, closeBtn);

  overlay.append(viewport, toolbar);
  document.body.appendChild(overlay);

  // --- Transform state -----------------------------------------------------
  let scale = 1;
  let translateX = 0;
  let translateY = 0;

  const applyTransform = () => {
    if (svg) {
      // Resize the SVG itself (not a CSS scale) so the vector re-renders
      // crisply at the target zoom rather than being a scaled bitmap.
      svg.style.width = `${naturalW * scale}px`;
      svg.style.height = `${naturalH * scale}px`;
    }
    content.style.transform = `translate(${translateX}px, ${translateY}px)`;
    zoomLabel.textContent = `${Math.round(scale * 100)}%`;
  };

  // Fit the diagram to the viewport on open, then center it.
  const fitToViewport = () => {
    const vpRect = viewport.getBoundingClientRect();

    // Leave a margin so the diagram isn't flush against the edges.
    const fitScale = Math.min(
      (vpRect.width * 0.92) / naturalW,
      (vpRect.height * 0.92) / naturalH,
      1 // never upscale on open
    );
    scale = clamp(fitScale, MIN_SCALE, MAX_SCALE);
    translateX = (vpRect.width - naturalW * scale) / 2;
    translateY = (vpRect.height - naturalH * scale) / 2;
    applyTransform();
  };

  // Zoom toward a viewport-relative point (keeps that point stationary).
  const zoomAt = (factor: number, originX: number, originY: number) => {
    const newScale = clamp(scale * factor, MIN_SCALE, MAX_SCALE);
    const ratio = newScale / scale;
    // Point under cursor in content space stays fixed.
    translateX = originX - (originX - translateX) * ratio;
    translateY = originY - (originY - translateY) * ratio;
    scale = newScale;
    applyTransform();
  };

  const zoomCentered = (factor: number) => {
    const vpRect = viewport.getBoundingClientRect();
    zoomAt(factor, vpRect.width / 2, vpRect.height / 2);
  };

  // --- Wheel to zoom -------------------------------------------------------
  viewport.addEventListener(
    'wheel',
    e => {
      e.preventDefault();
      const vpRect = viewport.getBoundingClientRect();
      const originX = e.clientX - vpRect.left;
      const originY = e.clientY - vpRect.top;
      const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      zoomAt(factor, originX, originY);
    },
    { passive: false }
  );

  // --- Drag to pan ---------------------------------------------------------
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let panOriginTX = 0;
  let panOriginTY = 0;
  let moved = false;

  viewport.addEventListener('mousedown', e => {
    isPanning = true;
    moved = false;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panOriginTX = translateX;
    panOriginTY = translateY;
    viewport.classList.add('panning');
    e.preventDefault();
  });

  const onMouseMove = (e: MouseEvent) => {
    if (!isPanning) return;
    if (Math.abs(e.clientX - panStartX) > 3 || Math.abs(e.clientY - panStartY) > 3) {
      moved = true;
    }
    translateX = panOriginTX + (e.clientX - panStartX);
    translateY = panOriginTY + (e.clientY - panStartY);
    applyTransform();
  };

  const endPan = (e: MouseEvent) => {
    if (!isPanning) return;
    isPanning = false;
    viewport.classList.remove('panning');
    // A clean click (no drag) on empty backdrop closes the preview.
    if (!moved && e.target === viewport) close();
  };

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', endPan);

  // --- Close handling ------------------------------------------------------
  const close = () => {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', endPan);
    document.removeEventListener('keydown', onKeyDown);
    overlay.remove();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === '+' || e.key === '=') {
      zoomCentered(ZOOM_STEP);
    } else if (e.key === '-' || e.key === '_') {
      zoomCentered(1 / ZOOM_STEP);
    } else if (e.key === '0') {
      fitToViewport();
    }
  };
  document.addEventListener('keydown', onKeyDown);

  // Button + overlay handlers
  zoomInBtn.addEventListener('click', () => zoomCentered(ZOOM_STEP));
  zoomOutBtn.addEventListener('click', () => zoomCentered(1 / ZOOM_STEP));
  resetBtn.addEventListener('click', fitToViewport);
  closeBtn.addEventListener('click', close);

  // Initial layout (after the SVG is in the DOM so we can measure it).
  fitToViewport();
}

function makeButton(label: string, title: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'mermaid-preview-btn';
  btn.type = 'button';
  btn.textContent = label;
  btn.title = title;
  btn.setAttribute('aria-label', title);
  return btn;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
