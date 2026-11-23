import { signal } from "@preact/signals";
import type { Provenance } from "@exm/core/bundles";

/** The source panel: which number's origin is being shown. */
export const sourcePanel = signal<{ title: string; provenance: Provenance; detail?: string } | null>(null);
export const commandBarOpen = signal(false);
export const shortcutsOpen = signal(false);

export interface Command {
  id: string;
  label: string;
  group: string;
  keywords?: string;
  shortcut?: string;
  run: () => void;
}

/** Commands contributed by the active workspace, merged with the global ones. */
export const contextCommands = signal<Command[]>([]);
