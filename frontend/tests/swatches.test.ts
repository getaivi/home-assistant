// The single-pick palette's toggling. Colors come from the generated META
// palette.

import { afterEach, describe, expect, it, vi } from "vitest";
import "../src/aivi-swatches";
import type { AiviSwatches } from "../src/aivi-swatches";
import { $, META, tick } from "./harness";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("aivi-swatches", () => {
  it("renders a labeled button per palette color and toggles the pick", async () => {
    const el = document.createElement("aivi-swatches") as AiviSwatches;
    const onChange = vi.fn();
    el.colors = META.colors;
    el.value = null;
    el.onChange = onChange;
    document.body.append(el);
    await tick();
    expect(el.querySelectorAll("button.sw")).toHaveLength(META.colors.length);
    $(el, 'button[title="Mint"]').click();
    expect(onChange).toHaveBeenLastCalledWith("mint");
    $(el, 'button[title="Mint"]').click();
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
