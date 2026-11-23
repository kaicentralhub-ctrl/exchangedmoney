import { navigate } from "../state/router.js";
import { shortcutsOpen, type Command } from "../state/ui.js";

export const WORKSPACES = [
  { path: "/markets", label: "Markets", key: "m", ready: true, blurb: "Rates, cross rates and how today compares with history" },
  { path: "/cards", label: "Cards", key: "c", ready: true, blurb: "What each card really costs abroad, fee by fee" },
  { path: "/trip", label: "Trip", key: "t", ready: true, blurb: "Price a whole trip on your cards, and the cheapest card each time" },
  { path: "/receipt", label: "Receipt", key: "r", ready: false, blurb: "Check a rate you were given" },
  { path: "/sources", label: "Sources", key: "s", ready: true, blurb: "Every source, when we last collected it" },
] as const;

export function globalCommands(): Command[] {
  return [
    ...WORKSPACES.map((w) => ({
      id: `go-${w.path}`,
      group: "Go to",
      label: w.label + (w.ready ? "" : " (planned)"),
      keywords: w.blurb,
      shortcut: `g ${w.key}`,
      run: () => navigate(w.path),
    })),
    { id: "help-keys", group: "Help", label: "Keyboard shortcuts", shortcut: "?", run: () => (shortcutsOpen.value = true) },
  ];
}
