/**
 * Keep signed-in mobile shells (dashboard tabs / mobile bottom nav) pinned to the
 * *visible* viewport. After password login, iOS/Android often keep a stale
 * layout height until the next tab gesture — sync from visualViewport instead.
 */

function readVisibleViewportHeight() {
  const vv = window.visualViewport;
  const h = Math.round((vv && vv.height) || window.innerHeight || 0);
  return h > 0 ? h : 0;
}

export function syncAppViewportHeight() {
  const h = readVisibleViewportHeight();
  if (!h) return;
  document.documentElement.style.setProperty('--app-vh', `${h}px`);
}

/**
 * Blur focused inputs (keyboard) and remeasure a few times while the viewport settles.
 */
export function settleAppViewportHeight() {
  try {
    const active = document.activeElement;
    if (active && active !== document.body && typeof active.blur === 'function') {
      active.blur();
    }
  } catch (_) {
    /* ignore */
  }
  syncAppViewportHeight();
  requestAnimationFrame(() => {
    syncAppViewportHeight();
    requestAnimationFrame(syncAppViewportHeight);
  });
  [50, 150, 400].forEach((ms) => {
    window.setTimeout(syncAppViewportHeight, ms);
  });
}

let installed = false;

export function installAppViewportHeightSync() {
  if (installed) {
    syncAppViewportHeight();
    return;
  }
  installed = true;
  syncAppViewportHeight();
  window.addEventListener('resize', syncAppViewportHeight);
  window.addEventListener('orientationchange', syncAppViewportHeight);
  window.addEventListener('pageshow', settleAppViewportHeight);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', syncAppViewportHeight);
    window.visualViewport.addEventListener('scroll', syncAppViewportHeight);
  }
}
