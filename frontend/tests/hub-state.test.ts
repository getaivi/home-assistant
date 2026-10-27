// What the hub keeps across a change of view: its search and filter
// over a visit to an editor, and the focus when the offline banner goes.

import { afterEach, describe, expect, it } from "vitest";
import {
  $,
  $$,
  focused,
  hubCard,
  makeHass,
  mountPanel,
  openWidgetEditor,
  setInput,
  sr,
  takeBacks,
  text,
  tick,
  until,
} from "./harness";

afterEach(() => {
  document.body.innerHTML = "";
  takeBacks();
});

describe("the hub's search and filter", () => {
  it("survive a visit to an editor", async () => {
    // The hub is unmounted while an editor is open; what was typed
    // and picked is kept on the panel.
    const panel = await mountPanel();
    setInput($(sr(panel), ".hubbar input"), "la");
    $$(sr(panel), ".fchip")
      .find((c) => text(c).startsWith("Not fed"))!
      .click();
    await tick();
    await openWidgetEditor(panel, "laundry");
    panel.closeEditor();
    await until(() => !!sr(panel).querySelector(".hubbar"), "the hub again");
    expect(($(sr(panel), ".hubbar input") as HTMLInputElement).value).toBe("la");
    expect(text($(sr(panel), ".fchip.on"))).toMatch(/^Not fed/);
  });

  it("names the status chips by what the cards say, not by the Set up button", async () => {
    // "Set up" is only the button on unfed cards; the chip listing fed
    // cards is "Fed".
    const panel = await mountPanel();
    const chips = $$(sr(panel), ".fchip").map((c) => text(c).replace(/\d+$/, ""));
    expect(chips).toEqual(["All", "Fed", "Not fed", "Unsupported"]);
    expect(text($(hubCard(panel, "Laundry"), ".foot"))).toBe("Set up");
  });
});

describe("offline", () => {
  it("keeps focus in the hub when Retry brings Aivi back and its banner goes", async () => {
    // The Retry button leaves with the banner it sits in.
    const hass = makeHass();
    const orig = hass.callWS.bind(hass);
    let offline = true;
    hass.callWS = (msg: object): Promise<unknown> =>
      offline && (msg as { type: string }).type === "aivi/widgets"
        ? Promise.reject(new Error("unreachable"))
        : orig(msg);
    const panel = await mountPanel(hass);
    offline = false;
    const retry = $(sr(panel), ".banner button");
    retry.focus();
    retry.click();
    await until(() => !sr(panel).querySelector(".banner"), "banner gone");
    await until(() => focused(panel) !== null, "focus placed");
    expect(focused(panel)).toBe($(sr(panel), ".fchip.on"));
  });
});
