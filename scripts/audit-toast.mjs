/**
 * Mezz Audit Toast
 * Small unobtrusive GM notification panel, bottom-right corner.
 */

const CONTAINER_ID  = "mezz-audit-toast-container";
const MAX_VISIBLE   = 5;
const FADE_DELAY_MS = 6000;

function _getOrCreateContainer() {
  let el = document.getElementById(CONTAINER_ID);
  if (!el) {
    el = document.createElement("div");
    el.id = CONTAINER_ID;
    document.body.appendChild(el);
  }
  return el;
}

export function showAuditToast(html) {
  const container = _getOrCreateContainer();

  while (container.children.length >= MAX_VISIBLE) {
    container.removeChild(container.firstChild);
  }

  const toast = document.createElement("div");
  toast.classList.add("mezz-audit-toast");
  toast.innerHTML = html;
  toast.addEventListener("click", () => _removeToast(toast), { once: true });
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("mezz-audit-toast--visible"));

  toast._fadeTimer = setTimeout(() => _removeToast(toast), FADE_DELAY_MS);
}

function _removeToast(toast) {
  clearTimeout(toast._fadeTimer);
  toast.classList.remove("mezz-audit-toast--visible");

  // Fallback removal if transitionend never fires (e.g. element detached mid-transition)
  const fallback = setTimeout(() => toast.remove(), 1000);
  toast.addEventListener("transitionend", () => {
    clearTimeout(fallback);
    toast.remove();
  }, { once: true });
}
