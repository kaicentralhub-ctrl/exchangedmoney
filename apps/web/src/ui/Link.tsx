import type { ComponentChildren } from "preact";
import { href, navigate, path } from "../state/router.js";

export function Link(props: { to: string; query?: Record<string, string>; class?: string; children: ComponentChildren; title?: string }) {
  const url = href(props.to, props.query);
  const active = path.value === props.to || (props.to !== "/" && path.value.startsWith(`${props.to}/`));
  return (
    <a
      href={url}
      title={props.title}
      class={props.class}
      aria-current={active ? "page" : undefined}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(props.to, props.query);
      }}
    >
      {props.children}
    </a>
  );
}
