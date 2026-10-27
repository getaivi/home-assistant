// A tiny DOM builder for the preview renderers: a throwaway tree per
// payload rather than a Lit template.

export type HChild = Node | string | number | boolean | null | undefined | HChild[];

export function h(
  tag: string,
  props: Record<string, unknown> | null = {},
  ...children: HChild[]
): HTMLElement {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = String(v);
    else if (k === "style") el.style.cssText = String(v);
    else if (k.startsWith("on") && typeof v === "function")
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  const append = (c: HChild): void => {
    if (c == null || c === false) return;
    if (Array.isArray(c)) {
      for (const x of c) append(x);
      return;
    }
    el.append(c instanceof Node ? c : String(c));
  };
  for (const c of children) append(c);
  return el;
}
