// A stand-in for Home Assistant's <ha-icon>, for the harness only: the
// panel's preview draws approximate icons through it (see
// frontend/src/symbol-icons.ts), and outside Home Assistant nothing
// defines it. Like the real one it loads each icon on demand, here from
// the @mdi/svg devDependency the dev server serves, and sizes itself by
// --mdc-icon-size in the current color.

const SVG_DIR = new URL("../../node_modules/@mdi/svg/svg/", import.meta.url);

/** name -> the icon's path data ("" when MDI has no such icon). */
const paths = new Map();

function pathFor(name) {
  let path = paths.get(name);
  if (!path) {
    path = fetch(new URL(`${name}.svg`, SVG_DIR))
      .then((res) => (res.ok ? res.text() : ""))
      .then((svg) => / d="([^"]+)"/.exec(svg)?.[1] ?? "")
      .catch(() => "");
    paths.set(name, path);
  }
  return path;
}

class HaIcon extends HTMLElement {
  static observedAttributes = ["icon"];

  constructor() {
    super();
    this.attachShadow({ mode: "open" }).innerHTML =
      "<style>:host{fill:currentcolor}" +
      "svg{display:block;width:var(--mdc-icon-size,24px);height:var(--mdc-icon-size,24px)}</style>" +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path></path></svg>';
  }

  attributeChangedCallback() {
    const icon = this.getAttribute("icon") ?? "";
    // Snapshots wait on this count, so no shot catches an icon mid-load.
    window.__iconsLoading = (window.__iconsLoading ?? 0) + 1;
    void pathFor(icon.replace(/^mdi:/, "")).then((d) => {
      window.__iconsLoading -= 1;
      if (this.getAttribute("icon") === icon)
        this.shadowRoot.querySelector("path").setAttribute("d", d);
    });
  }
}

if (!customElements.get("ha-icon")) customElements.define("ha-icon", HaIcon);
