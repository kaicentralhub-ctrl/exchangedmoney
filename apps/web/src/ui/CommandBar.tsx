import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { commandBarOpen, contextCommands, type Command } from "../state/ui.js";
import { score } from "../lib/score.js";
import { globalCommands } from "./commands.js";

export function CommandBar() {
  const open = commandBarOpen.value;
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const all = [...contextCommands.value, ...globalCommands()];
  const results = useMemo(
    () =>
      all
        .map((c) => ({ c, s: score(query, `${c.label} ${c.group} ${c.keywords ?? ""}`) }))
        .filter((r) => r.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 12)
        .map((r) => r.c),
    [query, all.length, contextCommands.value],
  );

  useLayoutEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
      input.current?.focus();
    }
  }, [open]);
  useEffect(() => setIndex(0), [query]);
  if (!open) return null;

  const run = (c: Command | undefined) => {
    if (!c) return;
    commandBarOpen.value = false;
    c.run();
  };

  return (
    <div class="overlay" onMouseDown={(e) => e.target === e.currentTarget && (commandBarOpen.value = false)}>
      <div class="cmdbar" role="dialog" aria-label="Command bar">
        <input
          ref={input}
          autoFocus
          value={query}
          placeholder="Type a command, a currency or a bank…"
          aria-label="Command"
          onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") (e.preventDefault(), setIndex((i) => Math.min(results.length - 1, i + 1)));
            else if (e.key === "ArrowUp") (e.preventDefault(), setIndex((i) => Math.max(0, i - 1)));
            else if (e.key === "Enter") (e.preventDefault(), run(results[index]));
            else if (e.key === "Escape") commandBarOpen.value = false;
          }}
        />
        <ul role="listbox">
          {results.map((c, i) => (
            <li key={c.id} role="option" aria-selected={i === index} class={i === index ? "on" : ""} onMouseEnter={() => setIndex(i)} onClick={() => run(c)}>
              <span class="grp">{c.group}</span>
              <span class="lbl">{c.label}</span>
              {c.shortcut && <kbd>{c.shortcut}</kbd>}
            </li>
          ))}
          {results.length === 0 && <li class="empty">Nothing matches “{query}”.</li>}
        </ul>
      </div>
    </div>
  );
}
