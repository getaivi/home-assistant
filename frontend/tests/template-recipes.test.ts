// What the template workspace's Insert list writes for a goal (template-
// recipes.ts), the hints under a result (template-hints.ts) and the entity
// card (entity-card.ts): pure functions over the text and the harness's
// states.

import { render } from "lit";
import { afterEach, describe, expect, it } from "vitest";
import { entityAt, entityCard, entityNear, sinceText } from "../src/entity-card";
import { tOpt } from "../src/i18n";
import { closestSymbol, loadSymbols, symbolNamed } from "../src/sf-symbols";
import { resultHints, soleOutput } from "../src/template-hints";
import {
  isNumeric,
  RECIPES,
  type RecipeEntity,
  type RecipeKind,
  recipeCode,
  recipeInsert,
  recipeKind,
  recipesFor,
  recipesForEntity,
  recipeTitle,
  twoStates,
} from "../src/template-recipes";
import type { FieldFeedback } from "../src/types/content";
import { makeHass, STATES } from "./harness";

const hass = makeHass();
const entity = (id: string) => {
  const e = STATES[id];
  if (!e) throw new Error(`no ${id} in the harness`);
  return e;
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("recipes that fit the field", () => {
  it("picks the recipes by the kind of field", () => {
    const kinds: [string, RecipeKind][] = [
      ["text", "text"],
      ["url", "text"],
      ["number", "number"],
      ["money", "number"],
      ["timestamp", "time"],
      ["points", "points"],
      ["series", "points"],
      ["segment", "segment"],
      ["color", "color"],
      ["action_color", "color"],
      ["bool", "bool"],
      ["icon", "icon"],
      ["something-newer", "text"],
    ];
    for (const [slot, kind] of kinds) expect(recipeKind(slot)).toBe(kind);
    const ids = (slot: string): string[] => recipesFor(slot).map((r) => r.id);
    expect(ids("number")).toEqual(["rounded", "number"]);
    expect(ids("text")[0]).toBe("words");
    expect(ids("timestamp")).toContain("in-minutes");
    expect(ids("points")).toEqual(["attribute-list"]);
  });

  it("gives every recipe a title, and writes each whole, or with its entity's quotes empty", () => {
    for (const [kind, list] of Object.entries(RECIPES)) {
      expect(list.length, kind).toBeGreaterThan(0);
      for (const r of list) {
        expect(tOpt(recipeTitle(r)), r.id).toBeTruthy();
        const blank = r.write(null, undefined);
        expect(blank.text, r.id).toMatch(/^\{[{%]/);
        if (r.entity) expect(blank.text.slice(blank.from - 1, blank.from + 1), r.id).toBe("''");
      }
    }
    for (const r of RECIPES.points) expect(r.write(null, undefined).text).toMatch(/\| list \}\}$/);
  });

  it("fits recipes to an entity's domain, device class and state", () => {
    const ids = (kind: string, id: string): string[] =>
      recipesForEntity(kind, id, entity(id)).map((r) => r.id);
    expect(ids("text", "binary_sensor.garage")).toEqual([
      "words",
      "fallback",
      "time-since",
      "translated",
    ]);
    expect(ids("text", "sensor.living_temp")).toEqual(["rounded-unit", "fallback", "time-since"]);
    expect(ids("text", "sensor.next_bin")).toContain("time-of-day");
    expect(ids("timestamp", "sensor.next_bin")).toEqual(["entity-time", "last-changed"]);
    expect(ids("points", "sensor.nordpool")).toEqual(["attribute-list"]);
    expect(ids("points", "sensor.living_temp")).toEqual([]);
    expect(ids("bool", "lock.front_door")).toEqual(["is-on"]);
    expect(ids("color", "sensor.humidity")).toEqual(["color-by-number"]);
    expect(ids("icon", "binary_sensor.garage")).toEqual(["icon-on-off"]);
    expect(ids("icon", "sensor.phone_battery")).toEqual(["icon-by-level"]);
    expect(ids("icon", "sensor.humidity")).toEqual(["icon-by-level"]);
    expect(ids("icon", "sensor.living_temp")).toEqual([]);
  });

  it("writes icons Apple's symbol list has, for each kind of entity", async () => {
    const index = await loadSymbols();
    const [onOff, byLevel] = RECIPES.icon;
    if (!onOff || !byLevel) throw new Error("no recipe");
    const door = { state: "off", attributes: { device_class: "door" } };
    expect(onOff.write("binary_sensor.door", door).text).toBe(
      "{{ 'door.left.hand.open' if is_state('binary_sensor.door', 'on') else 'door.left.hand.closed' }}",
    );
    expect(onOff.write("lock.front_door", entity("lock.front_door")).text).toBe(
      "{{ 'lock.fill' if is_state('lock.front_door', 'locked') else 'lock.open.fill' }}",
    );
    expect(byLevel.write("sensor.phone_battery", entity("sensor.phone_battery")).text).toBe(
      "{% set v = states('sensor.phone_battery') | float(0) %}{{ 'battery.0percent' if v < 10 else " +
        "'battery.25percent' if v < 35 else 'battery.50percent' if v < 60 else " +
        "'battery.75percent' if v < 85 else 'battery.100percent' }}",
    );
    const classes = [
      "door",
      "opening",
      "garage_door",
      "window",
      "motion",
      "occupancy",
      "presence",
      "moisture",
      "smoke",
      "gas",
      "carbon_monoxide",
      "problem",
      "safety",
      "tamper",
      "sound",
      "vibration",
      "connectivity",
      "lock",
      "battery",
      "battery_charging",
      "heat",
    ];
    const entities: [string, RecipeEntity][] = [
      ...classes.map((dc): [string, RecipeEntity] => [
        `binary_sensor.${dc}`,
        { state: "off", attributes: { device_class: dc } },
      ]),
      ...["light", "switch", "fan", "humidifier", "lock", "cover", "valve", "person"].map(
        (domain): [string, RecipeEntity] => [`${domain}.x`, { state: "on", attributes: {} }],
      ),
      ["cover.garage", { state: "open", attributes: { device_class: "garage" } }],
      ["sensor.level", { state: "40", attributes: { unit_of_measurement: "%" } }],
      ["sensor.battery", { state: "40", attributes: { device_class: "battery" } }],
    ];
    let written = 0;
    for (const [id, e] of entities)
      for (const r of recipesForEntity("icon", id, e)) {
        written++;
        const names = [...r.write(id, e).text.matchAll(/'([a-z0-9.]+)'/g)]
          .map((m) => m[1] ?? "")
          .filter((name) => name !== id && !/^(on|open|locked|home)$/.test(name));
        expect(names.length, `${r.id} ${id}`).toBeGreaterThanOrEqual(2);
        for (const name of names) expect(symbolNamed(index, name), `${r.id} ${id}`).toBe(name);
      }
    expect(written).toBe(entities.length);
  });

  it("knows the words for an entity's two states", () => {
    expect(
      twoStates("binary_sensor.door", { state: "on", attributes: { device_class: "door" } }),
    ).toEqual({
      on: "on",
      yes: "open",
      no: "closed",
    });
    expect(twoStates("binary_sensor.x", { state: "on", attributes: {} })?.yes).toBe("on");
    expect(twoStates("lock.front_door", entity("lock.front_door"))?.on).toBe("locked");
    expect(twoStates("cover.garage", entity("cover.garage"))?.on).toBe("open");
    expect(twoStates("person.alex", { state: "home", attributes: {} })?.no).toBe("away");
    expect(twoStates("sensor.living_temp", entity("sensor.living_temp"))).toBeNull();
    expect(isNumeric("21.4")).toBe(true);
    expect(isNumeric("")).toBe(false);
    expect(isNumeric("on")).toBe(false);
  });

  it("writes a finished template for the entity", () => {
    const words = RECIPES.text[0];
    if (!words) throw new Error("no recipe");
    const door = { state: "off", attributes: { device_class: "door" } };
    expect(words.write("binary_sensor.door", door).text).toBe(
      "{{ 'Open' if is_state('binary_sensor.door', 'on') else 'Closed' }}",
    );
    // Each domain's own state and words: a cover is open, a lock locked,
    // a person home, whatever it reads now.
    const written = (id: string): string => words.write(id, entity(id)).text;
    expect(written("cover.garage")).toBe(
      "{{ 'Open' if is_state('cover.garage', 'open') else 'Closed' }}",
    );
    expect(written("cover.blinds")).toBe(
      "{{ 'Open' if is_state('cover.blinds', 'open') else 'Closed' }}",
    );
    expect(written("lock.front_door")).toBe(
      "{{ 'Locked' if is_state('lock.front_door', 'locked') else 'Unlocked' }}",
    );
    expect(written("script.bedtime")).toBe(
      "{{ 'On' if is_state('script.bedtime', 'on') else 'Off' }}",
    );
    expect(
      words.write("binary_sensor.leak", { state: "off", attributes: { device_class: "moisture" } })
        .text,
    ).toBe("{{ 'Wet' if is_state('binary_sensor.leak', 'on') else 'Dry' }}");
    // Every recipe writes, for every entity it fits, the state that
    // entity really has when on.
    for (const [id, e] of Object.entries(STATES)) {
      const two = twoStates(id, e);
      for (const r of recipesForEntity("text", id, e).concat(recipesForEntity("bool", id, e))) {
        const text = r.write(id, e).text;
        if (/is_state\(/.test(text)) expect(text, `${r.id} ${id}`).toContain(`'${two?.on}'`);
      }
    }
    // A share is for percentages only.
    expect(
      recipesForEntity("segment", "sensor.humidity", entity("sensor.humidity")).map((r) => r.id),
    ).toContain("share");
    expect(
      recipesForEntity("segment", "sensor.power_now", entity("sensor.power_now")).map((r) => r.id),
    ).not.toContain("share");
    expect(recipeCode(words, "binary_sensor.door", door)).toBe(
      "{{ 'Open' if is_state(…, 'on') else 'Closed' }}",
    );
    expect(recipeCode(words, null)).toBe("{{ 'On' if is_state('…', 'on') else 'Off' }}");
    const limit = recipesFor("bool").find((r) => r.id === "above");
    // The limit is the reading, selected to type over.
    expect(limit?.write("sensor.humidity", entity("sensor.humidity"))).toEqual({
      text: "{{ states('sensor.humidity') | float(0) > 54 }}",
      from: 42,
      to: 44,
    });
    const list = RECIPES.points[0];
    expect(list?.write("sensor.nordpool", entity("sensor.nordpool")).text).toBe(
      "{{ state_attr('sensor.nordpool', 'today') | map('float', 0) | list }}",
    );
    const minutes = recipesFor("timestamp").find((r) => r.id === "in-minutes");
    expect(minutes?.write(null, undefined)).toEqual({
      text: "{{ now() + timedelta(minutes=5) }}",
      from: 29,
      to: 30,
    });
  });

  it("takes the place of the state it reads better, else goes in at the caret", () => {
    const words = RECIPES.text[0];
    if (!words) throw new Error("no recipe");
    const porch = entity("light.porch");
    const written = "{{ 'On' if is_state('light.porch', 'on') else 'Off' }}";
    // The whole template is that entity's state: replaced.
    const doc = "{{ states('light.porch') }}";
    expect(recipeInsert(words, "light.porch", porch, doc, doc.length)).toEqual({
      from: 0,
      to: doc.length,
      text: written,
      select: [written.length, written.length],
    });
    // The caret in it, among other text: that tag alone.
    const among = "Porch: {{ states('light.porch') }}!";
    expect(recipeInsert(words, "light.porch", porch, among, 12)).toMatchObject({ from: 7, to: 34 });
    // Another entity's: at the caret, the expression alone inside a tag.
    expect(recipeInsert(words, "light.porch", porch, "{{ x ~  }}", 7)).toEqual({
      from: 7,
      to: 7,
      text: "'On' if is_state('light.porch', 'on') else 'Off'",
      select: [48, 48],
    });
    // Without an entity: the caret in its quotes, kept apart from a word.
    expect(recipeInsert(words, null, undefined, "Now", 3)).toEqual({
      from: 3,
      to: 3,
      text: " {{ 'On' if is_state('', 'on') else 'Off' }}",
      select: [22, 22],
    });
  });

  it("matches the entity id literally, whatever characters it has", () => {
    const words = RECIPES.text[0];
    if (!words) throw new Error("no recipe");
    const doc = "{{ states('sensor.a+b') }}";
    expect(recipeInsert(words, "sensor.a+b", undefined, doc, doc.length)).toMatchObject({
      from: 0,
      to: doc.length,
    });
    // Read as a pattern, the + would take this other entity for it.
    const other = "{{ states('sensor.aab') }}";
    expect(recipeInsert(words, "sensor.a+b", undefined, other, other.length)).toMatchObject({
      from: other.length,
      to: other.length,
    });
  });
});

describe("hints on a result", () => {
  const ok = (value: string, more: Partial<FieldFeedback> = {}): FieldFeedback => ({
    status: "ok",
    value,
    kind: "text",
    ...more,
  });
  const hints = (text: string, fb: FieldFeedback, kind = "text", clipped: string | null = null) =>
    resultHints({ feedback: fb, text, kind, hass, clipped });

  it("finds the one output of a template", () => {
    expect(soleOutput("a {{ x }} b")).toEqual({ start: 2, end: 9, inner: "x" });
    expect(soleOutput("{{ x }}{{ y }}")).toBeNull();
    expect(soleOutput("text")).toBeNull();
  });

  it("rounds a reading with clearly too many decimals to three significant digits", () => {
    const T = "{{ states('sensor.living_temp') | float(0) / 3 }} °C";
    const [hint] = hints(T, ok("7.133333333333333 °C"));
    expect(hint?.id).toBe("decimals");
    expect(hint?.text).toBe("It shows 15 decimals.");
    expect(hint?.fix).toEqual({
      label: "Round it",
      edit: {
        from: 0,
        to: 49,
        insert: "{{ (states('sensor.living_temp') | float(0) / 3) | round(2) }}",
      },
    });
    // Three significant digits whatever the size.
    const target = (value: string): string | undefined =>
      hints("{{ x }}", ok(value, { kind: "number" }), "number")[0]?.fix?.edit.insert;
    expect(target("0.15149")).toBe("{{ x | round(3) }}");
    expect(target("21.456")).toBe("{{ x | round(1) }}");
    expect(target("1234.5678")).toBe("{{ x | round(1) }}");
    // A price's three decimals mean something: no hint.
    expect(hints("{{ states('sensor.nordpool') }} EUR", ok("0.151 EUR"))).toEqual([]);
    expect(target("1.234")).toBeUndefined();
    // One already rounded needs nothing; neither does a template of
    // several outputs.
    expect(hints("{{ x | round(4) }}", ok("1.23456"))).toEqual([]);
    expect(hints("{{ a }}{{ b }}", ok("1.23456"))).toEqual([]);
  });

  it("says when an entity is unavailable, and offers words for it", () => {
    const [hint] = hints("{{ states('sensor.travel_spent') }}", ok("unavailable"));
    expect(hint?.text).toBe("Travel is unavailable right now, so the widget shows “unavailable”.");
    expect(hint?.fix?.edit.insert).toBe(
      "{{ states('sensor.travel_spent') if has_value('sensor.travel_spent') else 'No data' }}",
    );
    // Guarded already: said, nothing to fix.
    const guarded = hints(
      "{{ states('sensor.travel_spent') if has_value('x') else 'unavailable' }}",
      ok("unavailable"),
    );
    expect(guarded[0]?.fix).toBeUndefined();
    // Not a text field's concern.
    expect(hints("{{ states('sensor.travel_spent') }}", ok("unavailable"), "number")).toEqual([]);
  });

  it("explains a value the field cannot use, and fixes what is mechanical", () => {
    const fallback = (value: string): FieldFeedback => ({
      status: "fallback",
      value,
      kind: "text",
    });
    const unit = hints(
      "{{ states('sensor.living_temp', with_unit=True) }}",
      fallback("21.4 °C"),
      "number",
    );
    expect(unit[0]?.text).toBe(
      "This field takes a number, and “21.4 °C” is not one, so its fallback shows.",
    );
    expect(unit[0]?.fix?.edit.insert).toBe("{{ states('sensor.living_temp') }}");
    const bool = hints("{{ states('lock.front_door') }}", fallback("jammed"), "bool");
    expect(bool[0]?.fix).toEqual({
      label: "Compare with “locked”",
      edit: { from: 0, to: 31, insert: "{{ is_state('lock.front_door', 'locked') }}" },
    });
    expect(hints("{{ 'x' }}", fallback("x"), "color")[0]?.text).toContain("is not a color");
    expect(hints("{{ 'x' }}", fallback("x"), "timestamp")[0]?.text).toContain("date and time");
    expect(hints("{{ 'x' }}", fallback("x"), "icon")[0]?.text).toBe(
      "This field can't use “x”, so its fallback shows.",
    );
  });

  it("says what is cut off, by the wire or by the widget, and when it shows None", () => {
    expect(hints("{{ x }}", ok("a".repeat(70), { limit: 64 }))[0]?.text).toBe(
      "Aivi takes 64 characters here; the rest is cut off.",
    );
    expect(hints("{{ x }}", ok("long"), "text", "Small")[0]?.text).toBe(
      "The Small widget cuts it off at this length.",
    );
    expect(hints("{{ x }}", ok("None"))[0]?.id).toBe("none");
    // Two at most, and none for an error or an empty template.
    expect(hints("{{ x }}", ok("None", { limit: 2 }), "text", "Small")).toHaveLength(2);
    expect(hints("{{ x }}", { status: "error", error: "x" })).toEqual([]);
    expect(
      resultHints({ feedback: undefined, text: "", kind: "text", hass, clipped: null }),
    ).toEqual([]);
  });
});

describe("an icon name the symbol list lacks", () => {
  const ok = (value: string): FieldFeedback => ({ status: "ok", value, kind: "text" });

  it("finds the closest name Apple's list has", async () => {
    const index = await loadSymbols();
    expect(closestSymbol(index, "Bolt fill")).toBe("bolt.fill");
    expect(closestSymbol(index, "door.left.hand.opne")).toBe("door.left.hand.open");
    expect(closestSymbol(index, "lightbulb.fil")).toBe("lightbulb.fill");
    expect(closestSymbol(index, "mdi:garage-open-variant")).toBeNull();
    expect(closestSymbol(index, " ")).toBeNull();
  });

  it("says so under an icon's result, and puts the closest name in its place", async () => {
    const symbols = await loadSymbols();
    const hints = (text: string, value: string, kind = "icon") =>
      resultHints({ feedback: ok(value), text, kind, hass, clipped: null, symbols });
    const text = "{{ 'lightbulb.fil' if is_state('light.porch', 'on') else 'lightbulb' }}";
    const [hint] = hints(text, "lightbulb.fil");
    expect(hint?.text).toBe(
      "“lightbulb.fil” is not in Apple's symbol list, so the device may show no icon.",
    );
    expect(hint?.fix).toEqual({
      label: "Use “lightbulb.fill”",
      edit: { from: 4, to: 17, insert: "lightbulb.fill" },
    });
    // A name it has, or not an icon: nothing to say.
    expect(hints(text, "lightbulb")).toEqual([]);
    expect(hints(text, "lightbulb.fil", "text")).toEqual([]);
    // Built from parts, or nothing close: said, with no fix.
    expect(hints("{{ 'door.' ~ 'opne' }}", "door.opne")[0]?.fix).toBeUndefined();
    expect(hints("{{ 'mdi:door' }}", "mdi:door")[0]?.fix).toBeUndefined();
    // Before the list has loaded, nothing.
    expect(
      resultHints({ feedback: ok("x.y"), text: "{{ 'x.y' }}", kind: "icon", hass, clipped: null }),
    ).toEqual([]);
  });
});

describe("the entity card", () => {
  it("finds the entity id at an offset, in a call or a dotted path", () => {
    const text =
      "{{ states('sensor.nordpool') ~ states.light.porch.state ~ states('sensor.typo') }}";
    expect(entityAt(text, 12, hass)).toEqual({ id: "sensor.nordpool", from: 11, to: 26 });
    expect(entityAt(text, 26, hass)?.id).toBe("sensor.nordpool");
    expect(entityAt(text, 45, hass)).toEqual({ id: "light.porch", from: 38, to: 49 });
    // One Home Assistant lacks, in quotes: its card says so.
    expect(entityAt(text, 70, hass)?.id).toBe("sensor.typo");
    expect(entityAt(text, 5, hass)).toBeNull();
    expect(entityAt("{{ x.y.z }}", 5, hass)).toBeNull();
  });

  it("knows which entity a pick near the caret is for", () => {
    const text = "{{ states('light.porch') }} {{ states('sensor.nordpool') }}";
    expect(entityNear(text, 14, hass)).toBe("light.porch");
    expect(entityNear(text, text.length, hass)).toBe("sensor.nordpool");
    expect(entityNear(text, 0, hass)).toBe("light.porch");
    expect(entityNear("{{ 1 }}", 0, hass)).toBeNull();
  });

  it("says how long ago, in words", () => {
    const now = Date.parse("2026-10-05T12:00:00Z");
    expect(sinceText("2026-10-05T11:48:00Z", now)).toBe("12 minutes ago");
    expect(sinceText("2026-10-05T09:00:00Z", now)).toBe("3 hours ago");
    expect(sinceText("2026-10-03T12:00:00Z", now)).toBe("2 days ago");
    expect(sinceText("2026-10-05T11:59:30Z", now)).toBe("30 seconds ago");
    expect(sinceText("not a time", now)).toBeNull();
  });

  it("shows the name, state and unit, when it changed and its attributes", () => {
    const host = document.createElement("div");
    document.body.append(host);
    render(entityCard(hass, "sensor.nordpool", "c1"), host);
    const card = host.querySelector(".entcard") as HTMLElement;
    expect(card.id).toBe("c1");
    expect(card.getAttribute("role")).toBe("tooltip");
    expect(card.querySelector(".entname")?.textContent).toBe("Electricity price");
    expect(card.querySelector(".entstate")?.textContent).toBe("0.151 EUR/kWh");
    expect(card.querySelector(".entsince")?.textContent).toMatch(/^Changed \d+ minutes ago$/);
    const keys = [...card.querySelectorAll("dt")].map((d) => d.textContent);
    expect(keys).toEqual(["today", "raw_today", "raw_tomorrow"]);
    expect(card.querySelector("dd")?.textContent?.endsWith("…")).toBe(true);
    // Many attributes: the rest counted.
    const many = makeHass();
    many.states["sensor.many"] = {
      entity_id: "sensor.many",
      state: "1",
      attributes: Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`a${i}`, i])),
    };
    render(entityCard(many, "sensor.many", "c2"), host);
    expect(host.querySelectorAll("dt")).toHaveLength(8);
    expect(host.querySelector(".entmore")?.textContent).toBe("3 more attributes");
    // One Home Assistant lacks.
    render(entityCard(hass, "sensor.typo", "c3"), host);
    expect(host.querySelector(".entcard.missing")?.textContent).toBe(
      "Home Assistant has no sensor.typo.",
    );
  });
});
