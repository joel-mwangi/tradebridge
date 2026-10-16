export function readOrderResolution(getStorage, key) {
  if (!key) return null;
  try {
    return getStorage().getItem(key);
  } catch {
    return "unknown";
  }
}

export function writeOrderResolution(getStorage, key, value) {
  if (!key) return;
  try {
    getStorage().setItem(key, value);
  } catch {
    // Cross-tab persistence is best-effort; the current tab keeps its memory lock.
  }
}

export function clearOrderResolution(getStorage, key) {
  if (!key) return;
  try {
    getStorage().removeItem(key);
  } catch {
    // In-memory reconciliation state remains active until cleared.
  }
}