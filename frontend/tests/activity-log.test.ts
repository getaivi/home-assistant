// The Log page (aivi-activity-log): every account's pushes and presses on
// one timeline, with its two selects, its account picker, its footer,
// and the way in and out of it.

import { afterEach, describe, expect, it } from "vitest";
import { sentText } from "../src/activity-rows";
import type { PushRow } from "../src/types/accounts";
import {
  $,
  $$,
  mountPanel,
  mountRouted,
  setSelect,
  sr,
  takeBacks,
  text,
  tick,
  until,
} from "./harness";
import { liveHass, press } from "./live";

afterEach(() => {
  document.body.innerHTML = "";
  history.replaceState(null, "", "/");
  takeBacks();
});

const rows = (root: ParentNode): HTMLElement[] => $$(root, "aivi-activity-log .loglist .arow");

/** A select by its accessible name, and its options' texts. */
function select(root: ParentNode, label: string): HTMLSelectElement {
  return $(root, `aivi-activity-log .logsel select[aria-label="${label}"]`) as HTMLSelectElement;
}

function options(root: ParentNode, label: string): string[] {
  return [...select(root, label).options].map((o) => o.text);
}

/** The page at its route, with its rows (or, with `empty`, its empty
 * state) rendered: the subscription's first update lands after the
 * first render. */
async function openLog(empty = false): Promise<ReturnType<typeof mountRouted>> {
  const panel = await mountRouted("/log");
  await until(() => panel.view === "log", "the page");
  await until(
    () => (empty ? !!sr(panel).querySelector(".logcard .evempty") : rows(sr(panel)).length > 0),
    "the page's rows",
  );
  return panel;
}

describe("the Log page", () => {
  it("has its route, its name, and the pushes newest first with what each sent", async () => {
    const panel = await openLog();
    const root = sr(panel);
    expect(text($(root, "aivi-activity-log .topbar .title"))).toBe("Log");
    expect(root.querySelector("aivi-hub")).toBeNull();
    const list = rows(root).map((row) => [
      text($(row, ".aname")),
      text($(row, ".areq")),
      text($(row, ".aout")),
    ]);
    expect(list).toEqual([
      ["Front door", "To Aivi", "Delivered · 212 ms"],
      ["Washer", "To Aivi ×12", "Unchanged"],
      ["Front door", "To Aivi ×3", "Retrying"],
      ["Washer", "To Aivi", "Failed"],
      ["Front door", "To Aivi", "Delivered · 198 ms"],
    ]);
    // What was sent, behind a disclosure; why nothing went for an
    // unchanged push; the error of a failed one.
    const first = rows(root)[0]!;
    expect(text($(first, "details.abody summary"))).toBe("What was sent");
    // The request as it went: method and path, then the body.
    expect(text($(first, "details.abody pre"))).toMatch(/^PATCH \/widgets\/frontdoor \{/);
    expect(text($(first, "details.abody pre"))).toContain('"accent": "red"');
    // An activity's carries its lifecycle state beside the content.
    const washer = text($(rows(root)[1]!, "details.abody pre"));
    expect(washer).toMatch(/^PATCH \/activities\/washer \{/);
    expect(washer).toContain('"state": "ONGOING"');
    expect(text($(rows(root)[1]!, "details.abody .fhint"))).toContain("same content");
    expect(text($(rows(root)[3]!, ".perr"))).toContain("Aivi rejected the content");
    // One account: no picker; the stream's state at the top; nothing
    // narrowed, so no count line.
    expect(root.querySelector("aivi-activity-log .logaccts")).toBeNull();
    expect(text($(root, "aivi-activity-log .logstreams .evs"))).toBe("Not listening");
    expect(root.querySelector("aivi-activity-log .logcount")).toBeNull();
    // In memory by default, and the footer says so and how to keep it.
    expect(text($(root, "aivi-activity-log .logfoot"))).toContain("Kept in memory");
    expect(text($(root, "aivi-activity-log .logfoot"))).toContain("Keep the log across restarts");
  });

  it("says when the account keeps its log across restarts", async () => {
    history.replaceState(null, "", "/?keeplog=1");
    const panel = await openLog();
    expect(text($(sr(panel), "aivi-activity-log .logfoot"))).toContain("Kept across restarts");
  });

  it("mixes presses in, and narrows by what to show and what it is for", async () => {
    history.replaceState(null, "", "/?switchboard=1");
    const panel = await openLog();
    const root = sr(panel);
    await until(() => rows(root).length === 11, "both directions");
    expect(text($(root, "aivi-activity-log .logstreams .evs"))).toBe("Connected");
    // A press names its tile and, under it, the switchboard it is on.
    const porch = rows(root).find((row) => text($(row, ".aname")) === "Porch light")!;
    expect(text($(porch, ".areq"))).toBe("On");
    expect(text($(porch, ".awhere"))).toMatch(/^Living room · /);

    // Each option says how many rows it would show.
    expect(options(root, "Show")).toEqual([
      "Everything (11)",
      "Pushes to Aivi (6)",
      "Presses from your devices (5)",
      "Problems only (5)",
    ]);
    expect(options(root, "For")).toEqual([
      "Anything (11)",
      "Front door (3)",
      "Living room (6)",
      "Washer (2)",
    ]);

    setSelect(select(root, "Show"), "presses");
    await until(() => rows(root).length === 5, "presses only");
    expect(rows(root).every((row) => row.classList.contains("press"))).toBe(true);
    expect(text($(root, "aivi-activity-log .logcount"))).toContain("5 of 11 entries");
    // The other select's counts follow: the Living room has every press.
    expect(options(root, "For")).toEqual([
      "Anything (5)",
      "Front door (0)",
      "Living room (5)",
      "Washer (0)",
    ]);
    setSelect(select(root, "Show"), "pushes");
    await until(() => rows(root).length === 6, "pushes only");
    // Unchanged pushes stay in view under Everything and Pushes.
    expect(rows(root).some((row) => text($(row, ".outcome")) === "Unchanged")).toBe(true);
    setSelect(select(root, "Show"), "problems");
    await until(() => rows(root).length === 5, "the problems");
    expect(rows(root).map((row) => text($(row, ".outcome")))).toEqual([
      "Failed",
      "Retrying",
      "Expired",
      "Failed",
      "Not handled",
    ]);

    // Narrowed to one Live Activity; the Show counts follow that.
    setSelect(select(root, "For"), "activity:washer");
    await until(() => rows(root).length === 1, "the washer's problem");
    expect(text($(rows(root)[0]!, ".aname"))).toBe("Washer");
    expect(options(root, "Show")).toEqual([
      "Everything (2)",
      "Pushes to Aivi (2)",
      "Presses from your devices (0)",
      "Problems only (1)",
    ]);
    expect(text($(root, "aivi-activity-log .logcount"))).toContain("1 of 11 entries");

    // Nothing matches: the empty state, with the way out.
    setSelect(select(root, "Show"), "presses");
    await until(() => !!root.querySelector("aivi-activity-log .evempty"), "no matches");
    expect(text($(root, "aivi-activity-log .evempty"))).toContain("Nothing matches");
    $(root, "aivi-activity-log .evempty .btn").click();
    await until(() => rows(root).length === 11, "everything again");
    expect(select(root, "Show").value).toBe("all");
    expect(select(root, "For").value).toBe("any");
    expect(root.querySelector("aivi-activity-log .logcount")).toBeNull();

    // The count line's own button resets too.
    setSelect(select(root, "For"), "widget:frontdoor");
    await until(() => rows(root).length === 3, "the front door");
    $(root, "aivi-activity-log .logcount .btn").click();
    await until(() => rows(root).length === 11, "everything once more");
  });

  it("picks an account when there are several", async () => {
    history.replaceState(null, "", "/?accounts=2&keeplog=acc2");
    const panel = await openLog();
    const root = sr(panel);
    const chips = $$(root, "aivi-activity-log .logaccts .fchip").map((c) => text(c));
    expect(chips).toEqual(["Home", "Cabin"]);
    expect(rows(root).length).toBe(5);
    $$(root, "aivi-activity-log .logaccts .fchip")[1]!.click();
    // The cabin feeds the Front door alone, and keeps its log.
    await until(() => rows(root).length === 3, "the cabin's rows");
    expect(rows(root).every((row) => text($(row, ".aname")) === "Front door")).toBe(true);
    expect(options(root, "For")).toEqual(["Anything (3)", "Front door (3)"]);
    expect(text($(root, "aivi-activity-log .logfoot"))).toContain("Kept across restarts");
  });

  it("says when nothing was logged yet", async () => {
    history.replaceState(null, "", "/?nopushes=1");
    const panel = await openLog(true);
    expect(text($(sr(panel), "aivi-activity-log .logcard .evempty"))).toContain("Nothing yet");
    expect(options(sr(panel), "For")).toEqual(["Anything (0)"]);
  });

  it("opens a row's editor and comes back to the page, and goes back to the hub", async () => {
    const panel = await mountPanel();
    await tick();
    panel.openLog();
    await until(() => panel.view === "log", "the page");
    expect(panel.route?.path).toBe("/log");
    const root = sr(panel);
    await until(() => rows(root).length > 0, "the rows");
    $(rows(root)[0]!, ".aname .evlink").click();
    await until(() => !!root.querySelector(".edbar .title"), "the editor");
    expect(text($(root, ".edbar .title"))).toBe("Front door");
    // Closing the editor returns to the page's own entry.
    takeBacks();
    panel.closeEditor();
    expect(panel.view).toBe("log");
    expect(takeBacks()).toBe(1);
    expect(panel.route?.path).toBe("/log");
    // Back from the page returns to the hub's entry.
    await until(() => !!root.querySelector("aivi-activity-log .backbtn"), "the page again");
    $(root, "aivi-activity-log .backbtn").click();
    expect(panel.view).toBe("home");
    expect(takeBacks()).toBe(1);
  });

  it("follows live updates", async () => {
    const live = liveHass();
    const panel = await mountRouted("/log", live.hass);
    await until(() => rows(sr(panel)).length === 5, "the rows");
    const pushed: PushRow = {
      id: "push_new",
      time: new Date(Date.now() + 1000).toISOString(),
      kind: "widget",
      slug: "frontdoor",
      subentry_id: "w1",
      outcome: "delivered",
      status: "ok",
      error: null,
      duration_ms: 90,
      request: { method: "PATCH", path: "/widgets/frontdoor", body: "x".repeat(40) },
      truncated: true,
      waiting: null,
      held: null,
      count: 1,
    };
    live.push({ stream: null, presses: [press(0)], pushes: [pushed] });
    await until(() => rows(sr(panel)).length === 2, "the update");
    const first = rows(sr(panel))[0]!;
    // A cut body is shown as the text it is, and says it is cut.
    expect(text($(first, "details.abody pre"))).toBe(`PATCH /widgets/frontdoor ${"x".repeat(40)}`);
    expect(text($(first, "details.abody .fhint"))).toContain("Cut off");
    expect(sentText({ ...pushed, request: null })).toBeNull();
  });
});
