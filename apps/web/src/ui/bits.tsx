import type { ComponentChildren } from "preact";
import type { Provenance } from "@exm/core/bundles";
import { sourcePanel } from "../state/ui.js";

export function SourceButton(props: { title: string; provenance: Provenance | undefined; detail?: string }) {
  if (!props.provenance) return null;
  return (
    <button
      class="src"
      title="Where this number comes from (i)"
      aria-label={`Source: ${props.provenance.label}`}
      onClick={(e) => {
        e.stopPropagation();
        sourcePanel.value = { title: props.title, provenance: props.provenance!, detail: props.detail };
      }}
    >
      i
    </button>
  );
}

export function Segmented<T extends string>(props: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div class="seg" role="radiogroup" aria-label={props.label}>
      <span class="seg-label">{props.label}</span>
      {props.options.map((o) => (
        <button key={o.value} role="radio" aria-checked={o.value === props.value} class={o.value === props.value ? "on" : ""} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Notice(props: { kind?: "error" | "info"; children: ComponentChildren }) {
  return <div class={`notice ${props.kind ?? "info"}`}>{props.children}</div>;
}

export function Loading(props: { what: string }) {
  return <div class="loading">Loading {props.what}…</div>;
}
