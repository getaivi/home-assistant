// What the template editor offers at the caret (code-editor/
// jinja-complete.ts), as pure functions over the harness's states: which
// context the caret is in, which entities, attributes, functions and
// filters come up, and what choosing one puts in.

import { describe, expect, it } from "vitest";
import { JINJA_FUNCTIONS, JINJA_TESTS } from "../src/code-editor/jinja-catalog";
import {
  type CompletionEnv,
  callAt,
  complete,
  entityOptions,
  filterOptions,
  functionOptions,
  type JinjaCompletions,
  namesBefore,
  pipeKind,
  placeAt,
} from "../src/code-editor/jinja-complete";
import { en } from "../src/translations/en";
import { STATES } from "./harness";

const env: CompletionEnv = {
  states: () => STATES,
  functions: JINJA_FUNCTIONS,
  tests: JINJA_TESTS,
  hint: (name) => `hint for ${name}`,
};

/** The completions with the caret at the end of `text`, marked by its
 * last character, a `|`. */
function at(text: string, explicit = false): JinjaCompletions | null {
  const pos = text.length - 1;
  return complete(text.slice(0, pos), pos, explicit, env);
}

function labels(found: JinjaCompletions | null): string[] {
  return (found?.options ?? []).map((o) => o.label);
}

describe("where the caret is", () => {
  it("finds the open tag and the quote around the caret", () => {
    expect(placeAt("hi {{ states('se", 16)).toEqual({
      tag: "{{",
      start: 5,
      quote: "'",
      quoteAt: 13,
    });
    expect(placeAt("{%- if x", 8)).toMatchObject({ tag: "{%", start: 3, quote: null });
    expect(placeAt("{{ 1 }} text", 12).tag).toBeNull();
    // A closing brace inside a string does not close the tag.
    expect(placeAt("{{ '}}' ", 8).tag).toBe("{{");
    // An escaped quote stays inside the string.
    expect(placeAt("{{ 'it\\'s ", 10).quote).toBe("'");
    // Comments, open or closed, are text.
    expect(placeAt("{# states('", 11).tag).toBeNull();
    expect(placeAt("{# x #}{{ ", 10).tag).toBe("{{");
  });

  it("names the call a string is an argument of", () => {
    expect(callAt("states(")).toEqual({ fn: "states", arg: 0, firstArg: null, whole: true });
    expect(callAt("state_attr('climate.x', ")).toEqual({
      fn: "state_attr",
      arg: 1,
      firstArg: "climate.x",
      whole: true,
    });
    expect(callAt("iif(is_state(")).toMatchObject({ fn: "is_state", arg: 0 });
    expect(callAt("states[")).toMatchObject({ fn: "states[", arg: 0 });
    // A closed call is left behind: the string belongs to the outer one.
    expect(callAt("iif(states('a') == 'on', ")).toMatchObject({ fn: "iif", arg: 1 });
    // Part of a longer expression, not the argument itself.
    expect(callAt("states('sensor.' ~ ")).toMatchObject({ whole: false });
    expect(callAt("x) ) (")).toMatchObject({ fn: null, arg: 0 });
  });
});

describe("entities", () => {
  it("offers every entity in the first quotes of states() and its kin", () => {
    for (const call of ["states", "is_state", "state_attr", "has_value", "expand", "area_name"]) {
      const found = at(`{{ ${call}('|`);
      expect(found?.filter, call).toBe(false);
      expect(found?.from, call).toBe(call.length + 5);
      expect(found?.options.length, call).toBe(Object.keys(STATES).length);
    }
    expect(labels(at("{{ states['|"))).toContain("sensor.living_temp");
    expect(labels(at("{% if iif(is_state('|"))).toContain("light.porch");
  });

  it("narrows by id or name, ids starting with the text first", () => {
    expect(labels(at("{{ states('sensor.l|"))).toEqual([
      "sensor.living_temp",
      "sensor.lock_battery",
    ]);
    // By name too: the blinds are named for the room; ids holding the
    // text come first.
    expect(labels(at("{{ states('living|"))).toEqual([
      "climate.living_room",
      "sensor.living_temp",
      "cover.blinds",
    ]);
    const option = at("{{ states('sensor.living|")?.options[0];
    expect(option).toEqual({
      label: "sensor.living_temp",
      type: "entity",
      detail: "Living room temperature",
    });
  });

  it("caps a long list and leaves out a nameless entity's detail", () => {
    const many = Object.fromEntries(
      Array.from({ length: 150 }, (_, i) => [`sensor.s${i}`, { state: "1", attributes: {} }]),
    );
    const options = entityOptions(many, "sensor.");
    expect(options).toHaveLength(100);
    expect(options[0]).toEqual({ label: "sensor.s0", type: "entity" });
  });

  it("offers entities in any other string once it looks like an id, or when asked", () => {
    expect(labels(at("{{ 'sensor.liv|"))).toEqual(["sensor.living_temp"]);
    expect(at("{{ 'abc|")).toBeNull();
    expect(labels(at("{{ 'porch|", true))).toContain("light.porch");
    expect(at("{{ 'nothing like it|", true)).toBeNull();
    // The second argument of is_state is a state, not an entity.
    expect(at("{{ is_state('light.porch', '|")).toBeNull();
    expect(at("{{ states('sensor.' ~ '|")).toBeNull();
    // expand takes an entity in every argument.
    expect(labels(at("{{ expand('light.porch', 'sensor.liv|"))).toEqual(["sensor.living_temp"]);
  });
});

describe("attributes", () => {
  it("offers the attributes of the entity in the first argument, with their values", () => {
    const found = at("{{ state_attr('climate.living_room', '|");
    expect(found?.filter).toBe(true);
    expect(found?.options).toEqual([
      { label: "current_temperature", type: "attribute", detail: "21.4" },
      { label: "friendly_name", type: "attribute", detail: "Living room thermostat" },
      { label: "hvac_action", type: "attribute", detail: "heating" },
      { label: "temperature", type: "attribute", detail: "22" },
    ]);
    expect(at("{{ is_state_attr('climate.living_room', 'hv|")?.from).toBe(41);
  });

  it("shortens a long value", () => {
    const found = complete("{{ state_attr('sensor.x', '", 27, false, {
      ...env,
      states: () => ({ "sensor.x": { state: "1", attributes: { today: Array(40).fill(0.15) } } }),
    });
    const detail = found?.options[0]?.detail ?? "";
    expect(detail).toHaveLength(40);
    expect(detail.endsWith("…")).toBe(true);
  });

  it("offers nothing without an entity, and nothing for one Home Assistant lacks", () => {
    expect(at("{{ state_attr(x, '|")).toBeNull();
    expect(at("{{ state_attr('sensor.nope', '|")?.options).toEqual([]);
  });
});

describe("dotted paths from states", () => {
  it("offers domains, then entities, then a state's properties and attributes", () => {
    expect(labels(at("{{ states.|"))).toContain("binary_sensor");
    expect(labels(at("{{ states.|")).filter((d) => d === "sensor")).toHaveLength(1);
    const sensors = at("{{ states.sensor.liv|");
    expect(sensors?.from).toBe(17);
    expect(sensors?.options).toContainEqual({
      label: "living_temp",
      type: "entity",
      detail: "Living room temperature",
    });
    expect(labels(at("{{ states.climate.living_room.|"))).toEqual([
      "state",
      "attributes",
      "name",
      "entity_id",
      "domain",
      "object_id",
      "last_changed",
      "last_updated",
    ]);
    expect(labels(at("{{ states.climate.living_room.attributes.|"))).toContain("hvac_action");
  });

  it("offers nothing after other dots", () => {
    expect(at("{{ now().|")).toBeNull();
    expect(at("{{ 1.|")).toBeNull();
    expect(at("{{ x.y.|")).toBeNull();
    expect(at("{{ states.nope.|")).toBeNull();
    expect(at("{{ states.sensor.nope.|")).toBeNull();
    expect(at("{{ states.sensor.living_temp.attributes.x.|")).toBeNull();
    expect(at("{{ states.sensor.living_temp.state.|")).toBeNull();
  });
});

/** The labels in the order the list shows them when nothing is typed:
 * by boost, then by label (CodeMirror's order for equal matches). */
function ranked(found: JinjaCompletions | null): string[] {
  return [...(found?.options ?? [])]
    .sort((a, b) => (b.boost ?? 0) - (a.boost ?? 0) || a.label.localeCompare(b.label))
    .map((o) => o.label);
}

describe("functions, filters and statements", () => {
  it("offers functions on typing a name or on asking, never on a bare {{", () => {
    expect(at("{{ sta|")?.from).toBe(3);
    expect(labels(at("{{ sta|"))).toContain("state_attr");
    // Nothing opens unasked right after {{ or {% and a space.
    expect(at("{{ |")).toBeNull();
    expect(at("{% |")).toBeNull();
    expect(at("{{|")).toBeNull();
    expect(labels(at("{{|", true))).toEqual(
      labels({ from: 0, options: functionOptions(env), filter: true }),
    );
    expect(at("{{ 1 + |")).toBeNull();
    expect(labels(at("{{ 1 + |", true))).toContain("now");
    // The most used come first.
    expect(ranked(at("{{ |", true)).slice(0, 4)).toEqual([
      "states",
      "state_attr",
      "is_state",
      "has_value",
    ]);
    // Outside any tag nothing is offered, asked or not.
    expect(at("sta|")).toBeNull();
    expect(at("{{ 1 }} sta|", true)).toBeNull();
  });

  it("offers the names {% set %} and {% for %} gave, first", () => {
    const text = "{% set total = 1 %}{% for e in expand('light.porch') %}{{ t|";
    expect(ranked(at(text)).slice(0, 4)).toEqual(["e", "loop", "total", "states"]);
    expect(at(text)?.options.find((o) => o.label === "total")).toEqual({
      label: "total",
      type: "variable",
      boost: 60,
    });
    expect(namesBefore("{% for a, b in x %}{% endfor %}{{ ", 33)).toEqual({
      names: ["a", "b"],
      inLoop: false,
    });
    // loop. inside a for, nothing outside one.
    expect(labels(at("{% for e in x %}{{ loop.|"))).toContain("index");
    expect(at("{{ loop.|")).toBeNull();
  });

  it("offers filters after a |, those that fit what is piped in first", () => {
    const found = at("{{ states('sensor.x') | |");
    expect(found?.filter).toBe(true);
    expect(labels(found)).toEqual(filterOptions(env).map((o) => o.label));
    expect(labels(found)).not.toContain("states");
    expect(ranked(found).slice(0, 3)).toEqual(["float", "int", "is_number"]);
    expect(ranked(at("{{ states('sensor.x') | float(0) | |"))[0]).toBe("round");
    expect(ranked(at("{{ expand('group.x') | |"))[0]).toBe("selectattr");
    expect(ranked(at("{{ as_timestamp(now()) | |"))[0]).toBe("timestamp_custom");
    expect(ranked(at("{{ states.sensor.x.last_changed | |"))[0]).toBe("as_timestamp");
    expect(at("{{ x |ro|")?.from).toBe(6);
  });

  it("knows what an expression pipes in", () => {
    expect(pipeKind("states('a') ")).toBe("state");
    expect(pipeKind("'text' |")).toBe("state");
    expect(pipeKind("1.5 ")).toBe("number");
    expect(pipeKind("x | float(0) ")).toBe("number");
    expect(pipeKind("states.light ")).toBe("list");
    expect(pipeKind("[1, 2] ")).toBe("list");
    expect(pipeKind("area_entities('kitchen') | select('is_state', 'on') ")).toBe("list");
    expect(pipeKind("now() ")).toBe("datetime");
    expect(pipeKind("value ")).toBe("other");
  });

  it("offers tests after is", () => {
    const found = at("{{ x is |");
    expect(labels(found)).toEqual(JINJA_TESTS);
    expect(found?.options[0]).toEqual({
      label: "defined",
      type: "test",
      info: "hint for is defined",
    });
    expect(labels(at("{% if x is not n|"))).toContain("none");
    expect(at("{{ this |")).not.toEqual(
      expect.objectContaining({
        options: expect.arrayContaining([expect.objectContaining({ type: "test" })]),
      }),
    );
  });

  it("offers the statements first in a {% %}, the open block's end first", () => {
    expect(labels(at("{% e|"))).toEqual([
      "if",
      "elif",
      "else",
      "endif",
      "for",
      "endfor",
      "set",
      "macro",
      "endmacro",
    ]);
    expect(ranked(at("{% if x %}{% e|"))[0]).toBe("endif");
    expect(ranked(at("{% for x in y %}{% if x %}{% endif %}{% e|"))[0]).toBe("endfor");
    expect(labels(at("{% for x in y %}{% b|"))).toContain("break");
    expect(ranked(at("{% s|")).slice(0, 3)).toEqual(["if", "set", "for"]);
    expect(labels(at("{% if is_|"))).toContain("is_state");
  });

  it("puts in a call with the caret where its argument goes", () => {
    const fns = functionOptions(env);
    expect(fns.find((o) => o.label === "states")).toEqual({
      label: "states",
      type: "function",
      detail: "(entity_id)",
      info: "hint for states",
      apply: "states('')",
      caret: 8,
      reopen: true,
      boost: 50,
    });
    // At the end: no caret position, nothing to open.
    expect(fns.find((o) => o.label === "now")).toEqual({
      label: "now",
      type: "function",
      detail: "()",
      info: "hint for now",
      apply: "now()",
      boost: 46,
    });
    // A time is not an entity: the list does not open again.
    expect(fns.find((o) => o.label === "today_at")?.reopen).toBeUndefined();
    const filters = filterOptions(env);
    expect(filters.find((o) => o.label === "round")).toMatchObject({
      type: "filter",
      apply: "round(1)",
    });
    expect(filters.find((o) => o.label === "list")).toEqual({
      label: "list",
      type: "filter",
      info: "hint for list",
    });
    expect(filters.find((o) => o.label === "default")).toMatchObject({
      apply: "default()",
      caret: 8,
    });
  });

  it("has a hint in the catalog for every function, filter and test", () => {
    const catalog = en as Record<string, string>;
    expect(JINJA_FUNCTIONS.length).toBeGreaterThanOrEqual(70);
    for (const f of JINJA_FUNCTIONS) expect(catalog[`code.fn-${f.name}`], f.name).toBeTruthy();
    for (const name of JINJA_TESTS) expect(catalog[`code.test-${name}`], name).toBeTruthy();
    // Each name once.
    expect(new Set(JINJA_FUNCTIONS.map((f) => f.name)).size).toBe(JINJA_FUNCTIONS.length);
  });
});
