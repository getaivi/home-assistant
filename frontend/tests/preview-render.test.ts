// Preview renderers: resolved payload -> preview DOM, template by
// template. Payloads come from the integration's recorded aivi/preview
// answers (over the fixture entities) wherever the fixtures produce them;
// other shapes (segmented bars, activity headers,
// gauge ring colors) are built inline against the wire types.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COLOR_HEX, SYSTEM_BLUE } from "../src/const";
import { previewActivity } from "../src/preview/activity";
import { previewWidget } from "../src/preview-render";
import type { Bindings } from "../src/types/bindings";
import type { WidgetContent } from "../src/types/content";
import { $, $$, css, makeHass, text } from "./harness";

const NOW = "2026-07-27T12:00:00Z";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

/** Resolves bindings through aivi/preview, like the panel. */
async function resolved(template: string, bindings: Bindings): Promise<WidgetContent> {
  const res = (await makeHass().callWS({
    type: "aivi/preview",
    template,
    bindings,
    kind: "widget",
  })) as { content: WidgetContent | null };
  if (!res.content) throw new Error(`unresolvable preview for ${template}`);
  return res.content;
}

/** The canned per-template bindings the mock suggests (fixture source). */
async function suggested(template: string): Promise<Bindings> {
  const p = makeHass().callWS({
    type: "aivi/suggest",
    template,
    kind: "widget",
    name: "t",
    description: "d",
  }) as Promise<{ bindings?: Bindings }>;
  await vi.advanceTimersByTimeAsync(700);
  return (await p).bindings ?? {};
}

describe("previewWidget", () => {
  it("status: hero shows the state with its bound color and accent chip", async () => {
    const content = await resolved("status", await suggested("status"));
    const el = previewWidget("status", "Front door", content);
    expect(text($(el, ".pv-name"))).toBe("Front door");
    const hero = $(el, ".pv-hero");
    expect(text(hero)).toBe("on");
    expect(css(hero)).toContain(COLOR_HEX.red);
    expect(css($(el, ".pv-chip"))).toContain(COLOR_HEX.red);
  });

  it("status: a value takes the hero and the state drops to the subline", async () => {
    const content = await resolved("status", {
      state: "input_text.washer_state",
      value: "input_number.washer_progress",
    });
    const el = previewWidget("status", "Washer", content);
    expect(text($(el, ".pv-hero"))).toBe("62");
    expect(text($(el, ".pv-state"))).toBe("Washing");
  });

  it("status: a time_until formatter renders the ticking timer reading", async () => {
    // Through aivi/preview end to end: the resolver must carry the
    // formatter onto the wire value like blocks.Value does. On-device the
    // formatter is a ticking timer, not relative words.
    const content = await resolved("status", {
      state: "sensor.next_bin", // 2026-07-30T07:00Z, 67 h from NOW
      state__formatter: "time_until",
    });
    const el = previewWidget("status", "Bins", content);
    expect(text($(el, ".pv-hero"))).toBe("67:00:00");
  });

  it("status: a time_since formatter counts up from past timestamps", () => {
    const el = previewWidget("status", "Mail", {
      state: { value: "2026-07-27T11:55:00+00:00", formatter: "time_since" },
    });
    expect(text($(el, ".pv-hero"))).toBe("5:00");
  });

  it("status: a formatted non-timestamp value falls back to the raw string", () => {
    const el = previewWidget("status", "Washer", {
      state: { value: "Washing", formatter: "time_since" },
    });
    expect(text($(el, ".pv-hero"))).toBe("Washing");
  });

  it("status: with nothing to show the hero is a placeholder, not the name again", () => {
    // The state is required, so a widget that resolves has a hero; one
    // that does not yet (nothing bound, a template that fails) shows
    // where it goes, as the caption over the preview says.
    const el = previewWidget("status", "Front door", {});
    expect(el.querySelector(".pv-hero")).toBeNull();
    expect(text($(el, '[data-slot="hero"][data-ghost]'))).toBe("State");
    expect(text($(el, ".pv-name"))).toBe("Front door");
  });

  it("progress: state hero and a bar at the resolved percentage", async () => {
    const content = await resolved("progress", await suggested("progress"));
    const el = previewWidget("progress", "Laundry", content);
    expect(text($(el, ".pv-hero"))).toBe("Washing");
    expect(css($(el, ".pv-bar i"))).toContain("width:62%");
  });

  it("progress: without a state the hero is the device's literal percent", async () => {
    const content = await resolved("progress", {
      progress: "input_number.washer_progress",
    });
    const el = previewWidget("progress", "Laundry", content);
    // The integer percent verbatim: the device never locale-formats it.
    expect(text($(el, ".pv-hero"))).toBe("62%");
  });

  it("progress: the solid bar defaults to system blue, never the accent", () => {
    // The bar color falls back to system blue on-device; the theme's
    // explicit bar color always outranks the widget accent.
    const el = previewWidget("progress", "Laundry", {
      progress: { value: 0.62 },
      accent: "orange",
    });
    expect(css($(el, ".pv-bar i"))).toContain(COLOR_HEX.blue);
  });

  it("progress: the bound state color paints the hero even when it is the timer", () => {
    // The hero color is seeded from state.text_color whatever the hero
    // shows (timer, state word, or percent).
    const el = previewWidget("progress", "Laundry", {
      progress: { value: 0.62 },
      state: { value: "Washing", text_color: "cyan" },
      end_date: "2026-07-27T13:00:00Z", // future: the timer is the hero
    });
    const hero = $(el, ".pv-hero");
    expect(text(hero)).toBe("1:00:00");
    expect(css(hero)).toContain(COLOR_HEX.cyan);
  });

  it("progress: a state hero keeps its bound text color", async () => {
    const content = await resolved("progress", {
      progress: "input_number.washer_progress",
      state: "input_text.washer_state",
      state__color: "cyan",
    });
    const el = previewWidget("progress", "Laundry", content);
    const hero = $(el, ".pv-hero");
    expect(text(hero)).toBe("Washing");
    expect(css(hero)).toContain(COLOR_HEX.cyan);
  });

  it("progress: a future end_date turns the hero into a live timer", async () => {
    const content = await resolved("progress", {
      ...(await suggested("progress")),
      end_date: "sensor.next_bin", // 2026-07-30T07:00Z, 67 h from NOW
    });
    vi.setSystemTime(new Date(NOW)); // suggested() advanced the fake clock
    const el = previewWidget("progress", "Laundry", content);
    expect(text($(el, ".pv-hero"))).toBe("67:00:00");
    expect(text($(el, ".pv-state"))).toBe("Washing");
  });

  it("progress: a segmented payload renders per-segment capsules", () => {
    // A segmented payload shaped as types/content.ts describes it.
    const content: WidgetContent = {
      state: { value: "Drying" },
      progress: {
        style: "segmented",
        value: 0.5,
        segments: [
          { value: 0.25, fill_color: "cyan" },
          { value: 0.75, fill_color: "blue", track_fill: "hatched" },
        ],
      },
    };
    const el = previewWidget("progress", "Laundry", content);
    const segs = $$(el, ".pv-canvas > div:last-child > div");
    expect(segs).toHaveLength(2);
    // First segment (0..0.25) is fully filled at value 0.5, second is 1/3.
    expect(css($(segs[0]!, "i"))).toContain("width:100%");
    expect(css($(segs[1]!, "i"))).toMatch(/width:33\.3+/);
    expect(css(segs[1]!)).toContain("repeating-linear-gradient");
  });

  it("progress: widgets render split even when display says layered", () => {
    // The wire contract: widgets always render split, never labels.
    // The layered flag is the Live Activity variant only.
    const el = previewWidget("progress", "Laundry", {
      progress: {
        style: "segmented",
        display: "layered",
        value: 0.5,
        segments: [
          { value: 0.5, fill_color: "cyan", label: "Wash" },
          { value: 0.5, fill_color: "blue" },
        ],
      },
    });
    const bar = $(el, ".pv-canvas > div:last-child");
    expect(css(bar)).toContain("gap:6px");
    expect(text(bar)).not.toContain("Wash");
  });

  it("gauge: dial with hero value, unit, label, and default bounds", async () => {
    const content = await resolved("gauge", await suggested("gauge"));
    const el = previewWidget("gauge", "Thermostat", content);
    expect(text($(el, ".pv-name"))).toBe("Living room");
    // "°C21.4°C": the leading copy is the invisible counterweight.
    expect(text($(el, ".pv-hero"))).toBe("°C21.4°C");
    expect(el.querySelector("svg path")).not.toBeNull();
    expect(text(el)).toContain("0 – 1");
  });

  it("gauge: explicit bounds and a solid ring color", async () => {
    const content: WidgetContent = {
      ...(await resolved("gauge", await suggested("gauge"))),
      min_value: 0,
      max_value: 30,
      color: "red",
    };
    const el = previewWidget("gauge", "Thermostat", content);
    expect(text(el)).toContain("0 – 30");
    expect(el.innerHTML).toContain(`stroke="${COLOR_HEX.red}"`);
  });

  it("gauge: a multi-stop gradient interpolates along the arc", async () => {
    const content: WidgetContent = {
      ...(await resolved("gauge", await suggested("gauge"))),
      gradient: ["cyan", "green"],
    };
    const el = previewWidget("gauge", "Thermostat", content);
    expect(el.innerHTML).toContain("rgb(");
  });

  it("gauge: the dial icon stays secondary, never the icon's own color", async () => {
    // The device styles the dial glyph secondary unconditionally: the
    // dial is the one place a styled icon does not carry its color.
    const content: WidgetContent = {
      ...(await resolved("gauge", await suggested("gauge"))),
      icon: { name: "thermometer", primary_color: "purple" },
    };
    const el = previewWidget("gauge", "Thermostat", content);
    // The 11 px glyph stacked above the hero inside the dial.
    const icon = $$(el, ".pv-grow div div").find((d) => css(d).includes("font-size:11px"))!;
    expect(css(icon)).not.toContain(COLOR_HEX.purple);
    expect(css(icon)).toContain("rgba(235,235,245");
  });

  it("gauge: a symbol unit is raised and counterweighted, verbatim", async () => {
    const content = await resolved("gauge", await suggested("gauge"));
    const el = previewWidget("gauge", "Thermostat", content);
    const hero = $(el, ".pv-hero");
    // The invisible leading counterweight duplicates the unit in
    // textContent: the price of the device's optical centering (the
    // app inserts a clear copy before the number).
    expect(text(hero)).toBe("°C21.4°C");
    const spans = $$(hero, "span");
    expect(css(spans[0]!)).toContain("visibility:hidden");
    // Raised by 0.28 of the hero's nominal size (26 % of the 96 pt dial).
    expect(css(spans[1]!)).toContain("vertical-align:6.99px");
  });

  it("gauge: a word unit is appended verbatim, unraised, no counterweight", async () => {
    const content: WidgetContent = {
      ...(await resolved("gauge", await suggested("gauge"))),
      unit: "ppm",
    };
    const el = previewWidget("gauge", "Thermostat", content);
    const hero = $(el, ".pv-hero");
    // The app appends the unit exactly as bound: no inserted
    // space, no baseline raise, no counterweight for word units.
    expect(text(hero)).toBe("21.4ppm");
    const spans = $$(hero, "span");
    expect(spans).toHaveLength(1);
    expect(css(spans[0]!)).not.toContain("vertical-align");
  });

  it("countdown: hero counts down to the target with an accent subline", async () => {
    const content = await resolved("countdown", await suggested("countdown"));
    vi.setSystemTime(new Date(NOW)); // suggested() advanced the fake clock
    const el = previewWidget("countdown", "Bin day", content);
    expect(text($(el, ".pv-hero"))).toBe("2 days, 19 hr");
  });

  it("list: rows show values, capped at four with an overflow badge", async () => {
    const content = await resolved("list", {
      rows: [
        "sensor.living_temp",
        "sensor.humidity",
        "sensor.power_now",
        "binary_sensor.garage",
        "sensor.outdoor_temp",
      ],
    });
    const el = previewWidget("list", "Home", content);
    expect($$(el, ".pv-list-row")).toHaveLength(4);
    expect(text($(el, ".pv-meta"))).toBe("+1");
    expect(text($$(el, ".pv-list-row")[0]!)).toBe("21.4");
  });

  it("list: row text is single-line with an ellipsis, values and labels alike", async () => {
    const content = await resolved("list", {
      rows: ["sensor.living_temp", "binary_sensor.garage"],
    });
    // A label-only row (no value) alongside a value row.
    content.rows = [
      ...(content.rows ?? []),
      { label: "A very long friendly name that must not wrap" },
    ];
    const el = previewWidget("list", "Home", content);
    for (const row of $$(el, ".pv-list-row")) {
      const spans = $$(row, "span");
      const textSpan = spans[spans.length - 1]!;
      // The list's stylesheet keeps both classes on one line with an
      // ellipsis (asserted in preview-list.test.ts).
      expect(textSpan.matches(".pv-list-label, .pv-list-value")).toBe(true);
    }
  });

  it("list: an icon-less row has no empty icon slot", () => {
    // The device renders no icon frame at all when the row has no icon:
    // the label/value starts at the leading edge on the device.
    const el = previewWidget("list", "Home", {
      rows: [
        { label: "No icon here" },
        { label: "Iconed", icon: { name: "lock.fill" }, value: { value: "42" } },
      ],
    });
    const rows = $$(el, ".pv-list-row");
    expect($$(rows[0]!, "span")).toHaveLength(1);
    expect($$(rows[1]!, "span")).toHaveLength(2);
    expect($$(rows[1]!, "span")[0]!.className).toBe("pv-list-icon");
  });

  it("battery: the ring glyph stays neutral, never the icon's own color", () => {
    // The ring carries the color and the glyph stays neutral: the
    // device styles it secondary unconditionally.
    const el = previewWidget("battery", "B", {
      devices: [{ name: "lock", level: 45, icon: { name: "lock.fill", primary_color: "indigo" } }],
    });
    const glyph = $(el, ".pv-battery-grid .pv-battery-ring > .pv-battery-glyph");
    expect(css(glyph)).not.toContain(COLOR_HEX.indigo);
    expect(css(glyph)).toContain("rgba(235,235,245");
  });

  it("battery: one ring per device, empty slots to fill the 2x2 grid", async () => {
    const content = await resolved("battery", await suggested("battery"));
    const el = previewWidget("battery", "Batteries", content);
    const grid = $(el, ".pv-battery-grid");
    expect($$(grid, ".pv-battery-row")).toHaveLength(2);
    expect($$(grid, ".pv-battery-row > *")).toHaveLength(4);
    expect($$(grid, "svg")).toHaveLength(2);
    expect($$(grid, ".pv-battery-placeholder")).toHaveLength(2);
  });

  it("battery: low level turns red unless charging, bolt when charging", () => {
    const el = previewWidget("battery", "B", {
      devices: [
        { name: "low", level: 15 },
        { name: "charging", level: 15, charging: true },
      ],
    });
    const svgs = $$(el, "svg");
    expect(svgs[0]!.outerHTML).toContain(`stroke="${COLOR_HEX.red}"`);
    expect(svgs[1]!.outerHTML).toContain(`stroke="${COLOR_HEX.green}"`);
    expect(svgs[0]!.querySelector(".pv-battery-bolt")).toBeNull();
    expect(svgs[1]!.querySelector(".pv-battery-bolt")?.getAttribute("fill")).toBe(COLOR_HEX.green);
  });

  it("switchboard: a 2x2 grid of tiles, lit by state, placeholders after", async () => {
    // The mock suggests four entities: the porch light (on, yellow, a warm
    // white whose gradient paints the tile), the fountain (off), the movie
    // scene (a button, not running) and the bedtime script (running, so
    // its tile is active).
    const content = await resolved("switchboard", await suggested("switchboard"));
    expect(content.actions?.map((a) => a.id)).toEqual([
      "light_porch",
      "switch_fountain",
      "scene_movie",
      "script_bedtime",
    ]);
    const el = previewWidget("switchboard", "Living room", content);
    const tiles = $$(el, ".pv-switchboard-grid > .pv-switchboard-tile");
    expect(tiles).toHaveLength(4);
    // On: the tile's gradient (else its color), run from the bottom trailing
    // corner. Active button: the accent. Off: quaternary.
    expect(css(tiles[0]!)).toContain("linear-gradient(315deg,#FFE4AD,#FFAE5E)");
    expect(css(tiles[1]!)).toContain("rgba(235,235,245,.18)");
    expect(css(tiles[2]!)).toContain("rgba(235,235,245,.18)");
    expect(css(tiles[3]!)).toContain(COLOR_HEX.indigo);
    expect(tiles.map((t) => text($(t, ".pv-switchboard-label")))).toEqual([
      "Porch light",
      "Garden fountain",
      "Movie night",
      "Bedtime",
    ]);
    // The app's small tile: the orb over the label and nothing else, no
    // second line at this size.
    expect(tiles.map((t) => [...t.children].map((c) => c.className))).toEqual(
      Array(4).fill(["pv-switchboard-orb", "pv-switchboard-label"]),
    );
    expect(el.querySelector(".pv-switchboard-second")).toBeNull();
    // The orb is the mark in the tile's paint: a gradient alone, the
    // glyph on a color, a quiet disc when off.
    const orbs = tiles.map((t) => $(t, ".pv-switchboard-orb"));
    expect(css(orbs[0]!)).toContain("linear-gradient(135deg,#FFE4AD,#FFAE5E)");
    expect(text(orbs[0]!)).toBe("");
    expect(css(orbs[1]!)).toContain("rgba(235,235,245,.18)");
    expect(text(orbs[1]!)).toBe("✦");
    expect(css(orbs[3]!)).toContain(COLOR_HEX.indigo);
    // Dark ink on the pale warm white, white on indigo, none when off.
    expect(css(tiles[0]!)).toContain("color:#1c1c1f");
    expect(css(tiles[3]!)).toContain("color:#fff");
    expect(css(tiles[1]!)).not.toContain("color:#");
    expect(tiles[0]!.getAttribute("aria-label")).toBe("Porch light, on");
    expect(tiles[0]!.getAttribute("data-action")).toBe("light_porch");
    // The small family shows no name; the grid is the slot.
    expect($$(el, ".pv-name")).toHaveLength(0);
    expect($(el, "[data-slot=grid]")).toBe($(el, ".pv-switchboard-grid"));
  });

  it("switchboard: fewer than four tiles leaves faint empty plates", () => {
    const el = previewWidget("switchboard", "S", {
      actions: [{ id: "a", label: "A", icon: "power", kind: "toggle", on: true }],
    });
    const cells = $$(el, ".pv-switchboard-grid > div");
    expect(cells).toHaveLength(4);
    expect(css(cells[0]!)).toContain(SYSTEM_BLUE);
    expect(cells.slice(1).every((c) => c.classList.contains("is-empty"))).toBe(true);
    // A plate, not a hole: the empty cell paints like an off tile, fainter.
    expect(css(cells[1]!)).toContain("rgba(235,235,245,.18)");
  });

  it("switchboard: hex colors, named gradient stops, and pictures", () => {
    const el = previewWidget("switchboard", "S", {
      actions: [
        { id: "a", label: "A", icon: "power", kind: "toggle", on: true, color: "#FF8800" },
        {
          id: "b",
          label: "B",
          icon: "sparkles",
          active: true,
          gradient: ["teal", "#3D3DFF"],
          image: { url: "https://e.com/b.png" },
          subtitle: { value: "Hall" },
        },
      ],
    });
    const tiles = $$(el, ".pv-switchboard-grid > .pv-switchboard-tile");
    expect(css(tiles[0]!)).toContain("#FF8800");
    expect(css(tiles[1]!)).toContain(`linear-gradient(315deg,${COLOR_HEX.teal},#3D3DFF)`);
    // The picture is the phone's to fetch; the preview marks the orb.
    expect($(tiles[1]!, ".pv-switchboard-orb").classList.contains("has-picture")).toBe(true);
    // The subtitle belongs to the sizes with a second line.
    expect(tiles[1]!.querySelector(".pv-switchboard-second")).toBeNull();
  });

  it("falls back to a placeholder for unknown templates", () => {
    const el = previewWidget("mystery", "X", {});
    expect(text($(el, ".pv-waiting"))).toBe("No preview for mystery");
  });
});

describe("previewActivity", () => {
  // Activity payloads are built inline against the wire types; the island
  // suite below resolves through aivi/preview. The banner mirrors the
  // medium-family Live Activity layouts.
  it("progress: header, bar, and footer lines around the fill", () => {
    const el = previewActivity("progress", "Washer", {
      icon: { name: "washer.fill", primary_color: "cyan" },
      header_left: { value: "Washing" },
      header_right: { value: "32 min left" },
      progress: { value: 0.62, color: "cyan" },
      footer_left: { value: "Delicates" },
      footer_right: { value: "62%" },
    });
    // The name is the banner headline (17 white semibold), the icon a
    // plain trailing glyph in its own color, with no chip on the banner.
    const nameEl = $(el, ".pv-banner-name");
    expect(text(nameEl)).toBe("Washer");
    expect(el.querySelector(".pv-chip")).toBeNull();
    const glyph = nameEl.nextElementSibling as HTMLElement;
    expect(css(glyph)).toContain(COLOR_HEX.cyan);
    expect(css(glyph)).toContain("font-size:17px");
    // Header slots render heavy; the right one dims to 70% white.
    const headRow = $$(el, ".pv-banner > div")[1]!;
    const [hl, hr] = [...headRow.children] as HTMLElement[];
    expect(text(hl!)).toBe("Washing");
    expect(css(hl!)).toContain("font-weight:800");
    expect(css(hl!)).toContain("color:#fff");
    expect(css(hr!)).toContain("color:rgba(255,255,255,.7)");
    // The banner bar is 12px (the medium family's bar height) with the
    // gray-30% track.
    const bar = $(el, ".pv-bar");
    expect(css(bar)).toContain("height:12px");
    expect(css($(el, ".pv-bar i"))).toContain("width:62%");
    // Footers: caption regular; left dims to 60%, the right stays white.
    const footRow = [...$$(el, ".pv-banner > div")].at(-1)!;
    const [fl, fr] = [...footRow.children] as HTMLElement[];
    expect(text(fl!)).toBe("Delicates");
    expect(css(fl!)).toContain("font-weight:400");
    expect(css(fl!)).toContain("color:rgba(255,255,255,.6)");
    expect(text(fr!)).toBe("62%");
    expect(css(fr!)).toContain("color:#fff");
    expect(text(el)).toContain("Lock Screen banner (approximate)");
  });

  it("progress: segmented style renders the split bar", () => {
    const el = previewActivity("progress", "Washer", {
      progress: {
        style: "segmented",
        value: 1,
        segments: [{ value: 0.5, fill_color: "cyan" }, { value: 0.5 }],
      },
    });
    expect(el.querySelector(".pv-bar")).toBeNull();
    expect($$(el, ".pv-banner i")).toHaveLength(2);
  });

  it("progress: a layered display renders the overlapping layers, labels below", () => {
    // The layered bar: layers stacked back-to-front inside one
    // capsule clip, each spanning 0..its cumulative end and emerging
    // through a soft gradient mask; labels sit below the bar.
    const el = previewActivity("progress", "Washer", {
      progress: {
        style: "segmented",
        display: "layered",
        value: 0.5,
        segments: [
          { value: 0.25, fill_color: "cyan", label: "Wash" },
          { value: 0.75, fill_color: "blue" },
        ],
      },
    });
    // Addressed by slot: the footer row always renders (as placeholders
    // when unbound), so the bar is not last.
    const stack = $(el, '.pv-banner [data-slot="bar"]');
    const [bar, row] = [...stack.children] as HTMLElement[];
    // One continuous capsule at the banner's 12px bar height.
    expect(css(bar!)).toContain("height:12px");
    expect(css(bar!)).toContain("border-radius:6px");
    expect(css(bar!)).toContain("overflow:hidden");
    const layers = [...bar!.children] as HTMLElement[];
    expect(layers).toHaveLength(2);
    // Layer widths run 0..cumulative end; the first layer paints on top
    // (higher z-index) and has no emergence mask, the second fades in.
    expect(css(layers[0]!)).toContain("width:25%");
    expect(css(layers[0]!)).toContain("z-index:2");
    expect(css(layers[0]!)).not.toContain("mask-image");
    expect(css(layers[1]!)).toContain("width:100%");
    expect(css(layers[1]!)).toContain("mask-image:linear-gradient");
    // The layered track default is gray at 30%, not the split bar's
    // solid gray (the two on-device defaults differ).
    expect(css($(layers[0]!, "i"))).toContain("rgba(142,142,147,.3)");
    // No label rides the bar; the fill honors the global value: layer 1
    // is fully filled at 0.5, layer 2 filled to the value's absolute
    // position (50% of its 0..1 span).
    expect(text(bar!)).toBe("");
    expect(css([...layers[0]!.children][1] as HTMLElement)).toContain("width:100%");
    expect(css([...layers[1]!.children][1] as HTMLElement)).toContain("width:50%");
    // The caption row: gapless columns (layered), caption typography,
    // the fixed 60% white of the device.
    expect(css(row!)).toContain("gap:0px");
    expect(text(row!)).toBe("Wash");
    const cell = row!.firstElementChild as HTMLElement;
    expect(css(cell)).toContain("font-size:11px");
    expect(css(cell)).toMatch(/color:rgba\(255,255,255,0?\.6\)/);
  });

  it("progress: a segmented payload without the flag stays split, labels below", () => {
    const el = previewActivity("progress", "Washer", {
      progress: {
        style: "segmented",
        value: 1,
        segments: [
          { value: 0.5, fill_color: "cyan", label: "Wash" },
          { value: 0.5, fill_color: "blue" },
        ],
      },
    });
    const stack = $(el, '.pv-banner [data-slot="bar"]');
    const [bar, row] = [...stack.children] as HTMLElement[];
    expect(css(bar!)).toContain("gap:6px");
    expect(css(bar!)).toContain("height:12px");
    expect(text(bar!)).not.toContain("Wash");
    // The banner labels a split bar on device (labels are on for the
    // lock-screen banner); the labels row
    // spaces columns at 2px there, independent of the 6px capsule gap.
    expect(css(row!)).toContain("gap:2px");
    expect(text(row!)).toBe("Wash");
  });

  it("monitor: two columns with headers, values, and footers", () => {
    const el = previewActivity("monitor", "Climate", {
      left_column: {
        header: "Inside",
        value: { value: "21.4°", text_color: "cyan" },
        footer: "heating",
      },
      right_column: { header: "Outside", value: { value: "14.8°" } },
    });
    expect(text(el)).toContain("Inside");
    expect(text(el)).toContain("21.4°");
    expect(text(el)).toContain("heating");
    expect(text(el)).toContain("Outside");
    const cols = $$(el, ".pv-banner > div")[1]!;
    // Columns sit top-aligned.
    expect(css(cols)).toContain("align-items:flex-start");
    const left = cols.firstElementChild as HTMLElement;
    const [header, value, footer] = [...left.children] as HTMLElement[];
    // Header: footnote semibold uppercase system gray.
    expect(css(header!)).toContain("font-size:13px");
    expect(css(header!)).toContain("font-weight:600");
    expect(css(header!)).toContain("text-transform:uppercase");
    expect(css(header!)).toContain(COLOR_HEX.gray);
    // Value: black (900) weight in its text_color ?? white.
    expect(css(value!)).toContain("font-weight:900");
    expect(css(value!)).toContain(COLOR_HEX.cyan);
    // Footer: footnote regular gray.
    expect(css(footer!)).toContain("font-size:13px");
    expect(css(footer!)).toContain("font-weight:400");
  });

  it("monitor: column captions truncate on one line like the values", () => {
    const el = previewActivity("monitor", "Climate", {
      right_column: {
        header: "A caption long enough to wrap",
        value: { value: "14.8°" },
        footer: "and a footer to match",
      },
    });
    const captions = $$(el, ".pv-banner div div div").filter((d) =>
      /caption|footer/.test(d.textContent ?? ""),
    );
    expect(captions.length).toBe(2);
    for (const c of captions) {
      expect(css(c)).toContain("text-overflow:ellipsis");
      expect(css(c)).toContain("white-space:nowrap");
    }
  });

  it("monitor: a formatted column value renders the ticking timer reading", () => {
    const el = previewActivity("monitor", "Mail", {
      right_column: {
        header: "Last pickup",
        value: { value: "2026-07-27T09:00:00+00:00", formatter: "time_since" },
      },
    });
    // On-device the formatter is a counting timer.
    expect(text(el)).toContain("3:00:00");
  });

  it("other templates fall back to just the header row, without an island", () => {
    const el = previewActivity("status", "Door", { state: { value: "on" } });
    expect(text($(el, ".pv-banner-name"))).toBe("Door");
    expect(el.querySelector(".pv-bar")).toBeNull();
    // No compact presentation exists for unknown templates: no island.
    expect(el.querySelector(".pv-island-pill")).toBeNull();
  });
});

describe("collapsed Dynamic Island", () => {
  /** Like `resolved`, for a Live Activity editor. */
  async function resolvedActivity(template: string, bindings: Bindings): Promise<WidgetContent> {
    const res = (await makeHass().callWS({
      type: "aivi/preview",
      template,
      bindings,
      kind: "activity",
    })) as { content: WidgetContent | null };
    if (!res.content) throw new Error(`unresolvable preview for ${template}`);
    return res.content;
  }

  it("progress: black pill, active-color ring, tinted compact value", async () => {
    const content = await resolvedActivity("progress", {
      progress: "input_number.washer_progress",
      bar_color: "cyan",
      compact_value: "input_text.washer_state",
      compact_value__color: "green",
    });
    const el = previewActivity("progress", "Washer", content);
    const pill = $(el, ".pv-island-pill");
    // The hardware pill is pure black whatever the page theme: dark is
    // the island's only look.
    expect(css(pill)).toContain("background:#000");
    // The island sits above the banner, each with its approximation note.
    expect(el.firstElementChild).toBe($(el, ".pv-island"));
    expect(text(el)).toContain("Dynamic Island (approximate)");
    expect(text(el)).toContain("Lock Screen banner (approximate)");
    // compactLeading: the progress ring, a track in white at 15% and the value arc
    // in the bar's active color (the bound bar color here).
    const svg = $(pill, "svg");
    expect(svg.outerHTML).toContain("rgba(255,255,255,.15)");
    expect(svg.outerHTML).toContain(`stroke="${COLOR_HEX.cyan}"`);
    // compactTrailing: the compact value at caption size in its color.
    const trailing = pill.lastElementChild as HTMLElement;
    expect(text(trailing)).toBe("Washing");
    expect(css(trailing)).toContain(COLOR_HEX.green);
    expect(css(trailing)).toContain("font-size:18px");
  });

  it("progress: an unbound compact value holds its place as a placeholder", async () => {
    const content = await resolvedActivity("progress", {
      progress: "input_number.washer_progress",
    });
    const pill = $(previewActivity("progress", "Washer", content), ".pv-island-pill");
    // On device this slot renders nothing; the editor keeps a dashed
    // stand-in, marked `data-ghost`, so it can be pressed before it is
    // bound.
    expect(pill.children).toHaveLength(3);
    const trailing = pill.lastElementChild as HTMLElement;
    expect(trailing.dataset["slot"]).toBe("island-value");
    expect(trailing.hasAttribute("data-ghost")).toBe(true);
    expect(text(trailing)).toBe("Dynamic Island");
  });

  it("progress: the ring takes the active segment's color", () => {
    const content: WidgetContent = {
      progress: {
        style: "segmented",
        value: 0.5,
        segments: [
          { value: 0.6, fill_color: "cyan" },
          { value: 0.4, fill_color: "indigo" },
        ],
      },
    };
    // The cursor at 0.5 sits in the first (cyan) segment…
    let svg = $($(previewActivity("progress", "W", content), ".pv-island-pill"), "svg");
    expect(svg.outerHTML).toContain(`stroke="${COLOR_HEX.cyan}"`);
    // …and at 0.9 in the second (indigo) one: the active segment's color.
    content.progress!.value = 0.9;
    svg = $($(previewActivity("progress", "W", content), ".pv-island-pill"), "svg");
    expect(svg.outerHTML).toContain(`stroke="${COLOR_HEX.indigo}"`);
  });

  it("progress: system-blue ring fallback; the center glyph takes the icon's color", () => {
    const el = previewActivity("progress", "W", {
      progress: { value: 0.3 },
      icon: { name: "washer.fill", primary_color: "orange" },
      compact_value: { value: "30%" },
    });
    const pill = $(el, ".pv-island-pill");
    expect($(pill, "svg").outerHTML).toContain(`stroke="${COLOR_HEX.blue}"`);
    const glyph = $(pill.firstElementChild as HTMLElement, "div");
    expect(css(glyph)).toContain(COLOR_HEX.orange);
  });

  it("progress: a formatted compact value renders the ticking timer reading", () => {
    const el = previewActivity("progress", "W", {
      progress: { value: 0.5 },
      compact_value: {
        value: "2026-07-27T09:00:00+00:00",
        formatter: "time_since",
      },
    });
    expect(text($(el, ".pv-island-pill").lastElementChild as HTMLElement)).toBe("3:00:00");
  });

  it("monitor: icon glyph leading, primary column value trailing, always white", () => {
    const el = previewActivity("monitor", "Climate", {
      icon: { name: "thermometer", primary_color: "orange" },
      left_column: { value: { value: "21.4°", text_color: "cyan" } },
      right_column: { value: { value: "14.8°", text_color: "cyan" } },
    });
    const pill = $(el, ".pv-island-pill");
    expect(css(pill.firstElementChild as HTMLElement)).toContain(COLOR_HEX.orange);
    const trailing = pill.lastElementChild as HTMLElement;
    // The primary column defaults to the right column on device…
    expect(text(trailing)).toBe("14.8°");
    // …and the compact slot applies no foreground style there, so the
    // value is always white: text_color must not tint it.
    expect(css(trailing)).toContain("color:#fff");
    expect(css(trailing)).not.toContain(COLOR_HEX.cyan);
  });

  it("monitor: primary_column left flips the pick; a missing pick falls back", () => {
    const flipped = previewActivity("monitor", "C", {
      primary_column: "left",
      left_column: { value: { value: "L" } },
      right_column: { value: { value: "R" } },
    });
    expect(text($(flipped, ".pv-island-pill").lastElementChild as HTMLElement)).toBe("L");
    // Default pick is right; with no right column bound, left stands in
    // (the pick, else left, else right).
    const fallback = previewActivity("monitor", "C", {
      left_column: { value: { value: "L" } },
    });
    expect(text($(fallback, ".pv-island-pill").lastElementChild as HTMLElement)).toBe("L");
  });

  it("monitor: no icon falls back to the default indicator glyph in white", () => {
    const el = previewActivity("monitor", "C", {
      right_column: { value: { value: "R" } },
    });
    const lead = $(el, ".pv-island-pill").firstElementChild as HTMLElement;
    expect(text(lead)).toBe("✦");
    expect(css(lead)).toContain("color:#fff");
  });
});

describe("switchboard state words in the preview", () => {
  it("reads an off tile's own word, and nothing when it is hidden", () => {
    const content: WidgetContent = {
      actions: [
        {
          id: "a",
          label: "Garage",
          icon: "power",
          kind: "toggle",
          on: false,
          state_text: { on: "Open", off: "Closed" },
        },
        {
          id: "b",
          label: "Gate",
          icon: "power",
          kind: "toggle",
          on: false,
          state_text: { off: "" },
        },
        { id: "c", label: "Lamp", icon: "power", kind: "toggle", on: false },
      ],
    };
    // Medium is the smallest size with a second line to read them on.
    const tiles = $$(
      previewWidget("switchboard", "S", content, "medium"),
      ".pv-switchboard-grid > .pv-switchboard-tile",
    ).slice(0, 3);
    expect(tiles.map((t) => text($(t, ".pv-switchboard-second")))).toEqual(["Closed", "", "Off"]);
    expect(
      previewWidget("switchboard", "S", content).querySelector(".pv-switchboard-second"),
    ).toBeNull();
  });
});

describe("gauge without a value yet", () => {
  it("draws the dial at its low end, never a NaN coordinate", () => {
    const el = previewWidget("gauge", "Thermostat", { template: "gauge" } as WidgetContent);
    expect(el.outerHTML).not.toContain("NaN");
    expect(el.querySelector("svg")).toBeTruthy();
  });
});
