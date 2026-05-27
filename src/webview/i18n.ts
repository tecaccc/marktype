/**
 * Minimal i18n for the webview.
 *
 * The webview runs in a browser context and has no access to `vscode.l10n`.
 * The extension host reads `vscode.env.language`, picks the matching bundle
 * from `l10n/webview.<lang>.json`, and ships it to the webview via the
 * `update` / `settingsUpdate` message. We just look up strings here.
 *
 * Callers pass the English source string as `fallback`, which doubles as the
 * default when the active bundle has no translation for the key.
 */

let bundle: Record<string, string> = {};

export function setI18nBundle(next: Record<string, string> | undefined | null): void {
  bundle = next && typeof next === 'object' ? next : {};
}

export function t(key: string, fallback: string): string {
  const value = bundle[key];
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}
