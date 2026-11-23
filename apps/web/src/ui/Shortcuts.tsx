import { shortcutsOpen } from "../state/ui.js";
import { WORKSPACES } from "./commands.js";

const ROWS: [string, string][] = [
  ["⌘ K  or  /", "Open the command bar"],
  ...WORKSPACES.map((w): [string, string] => [`g  ${w.key}`, `Go to ${w.label}`]),
  ["j  /  k", "Move down / up a row"],
  ["Enter", "Expand the selected row"],
  ["i", "Show the source of the selected row"],
  ["e", "Export the current view as CSV"],
  ["Esc", "Close a panel or dialog"],
  ["?", "This list"],
];

export function Shortcuts() {
  if (!shortcutsOpen.value) return null;
  return (
    <div class="overlay" onMouseDown={(e) => e.target === e.currentTarget && (shortcutsOpen.value = false)}>
      <div class="dialog" role="dialog" aria-label="Keyboard shortcuts">
        <header>
          <h2>Keyboard shortcuts</h2>
          <button class="icon" onClick={() => (shortcutsOpen.value = false)} aria-label="Close">
            ×
          </button>
        </header>
        <table class="keys">
          <tbody>
            {ROWS.map(([k, d]) => (
              <tr key={k}>
                <td>
                  <kbd>{k}</kbd>
                </td>
                <td>{d}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
