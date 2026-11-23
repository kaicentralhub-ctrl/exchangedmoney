import { navigate } from "../state/router.js";
import { commandBarOpen, shortcutsOpen, sourcePanel } from "../state/ui.js";
import { WORKSPACES } from "./commands.js";

/** Workspace-level key handlers (j/k/Enter/i/e); the active workspace sets this. */
export const workspaceKeys: { current: ((key: string, e: KeyboardEvent) => boolean) | null } = { current: null };

const typing = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

export function installKeys(): () => void {
  let pendingG = 0;
  const onKey = (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      commandBarOpen.value = !commandBarOpen.value;
      return;
    }
    if (e.key === "Escape") {
      if (commandBarOpen.value) commandBarOpen.value = false;
      else if (shortcutsOpen.value) shortcutsOpen.value = false;
      else if (sourcePanel.value) sourcePanel.value = null;
      return;
    }
    if (typing(e.target) || e.metaKey || e.ctrlKey || e.altKey || commandBarOpen.value) return;
    if (e.key === "/") return (e.preventDefault(), void (commandBarOpen.value = true));
    if (e.key === "?") return void (shortcutsOpen.value = !shortcutsOpen.value);
    if (e.key === "g") return void (pendingG = Date.now());
    if (pendingG && Date.now() - pendingG < 1200) {
      pendingG = 0;
      const w = WORKSPACES.find((x) => x.key === e.key);
      if (w) return navigate(w.path);
    }
    if (workspaceKeys.current?.(e.key, e)) e.preventDefault();
  };
  addEventListener("keydown", onKey);
  return () => removeEventListener("keydown", onKey);
}
