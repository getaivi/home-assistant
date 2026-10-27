// The panel's toasts: short messages that show for three seconds, then
// fade.

import { h } from "./dom";

export class Toasts {
  /** Where the toasts are appended; the panel places it in its root. */
  readonly host: HTMLElement = h("div", {
    class: "toasts",
    style: "display: contents",
  });

  show(text: string): void {
    const toast = h("div", { class: "toast", role: "status" }, text);
    this.host.append(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transition = "opacity .3s";
    }, 2600);
    setTimeout(() => toast.remove(), 3000);
  }
}
