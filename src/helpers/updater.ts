import { check, Update } from "@tauri-apps/plugin-updater";

export type { Update };

/**
 * Single shared entry point for checking for updates, used by both the
 * startup auto-check and the manual "Check for updates" button, so both
 * always check the same way.
 */
export function checkForUpdate(): Promise<Update | null> {
  return check();
}
