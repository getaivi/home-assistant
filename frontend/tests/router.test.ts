// The pure route helpers: parsing a panel path and formatting it back.

import { describe, expect, it } from "vitest";
import { formatRoute, parseRoute } from "../src/router";

describe("parseRoute", () => {
  it("maps the empty and bare-slash paths to the hub", () => {
    expect(parseRoute("")).toEqual({ view: "hub" });
    expect(parseRoute("/")).toEqual({ view: "hub" });
  });

  it("parses widget and activity editor paths", () => {
    expect(parseRoute("/widget/frontdoor")).toEqual({
      view: "widget",
      slug: "frontdoor",
    });
    expect(parseRoute("/activity/washer")).toEqual({
      view: "activity",
      slug: "washer",
    });
  });

  it("parses a template workspace's path: the editor's, its box's address, then template", () => {
    expect(parseRoute("/widget/frontdoor/state/template")).toEqual({
      view: "widget",
      slug: "frontdoor",
      template: "state",
    });
    expect(parseRoute("/activity/washer/compact_value__color/template")).toEqual({
      view: "activity",
      slug: "washer",
      template: "compact_value__color",
    });
    expect(parseRoute("/widget/laundry/segments.1.source/template")).toEqual({
      view: "widget",
      slug: "laundry",
      template: "segments.1.source",
    });
    expect(parseRoute("/widget/frontdoor/state")).toBeNull();
    expect(parseRoute("/widget/frontdoor/state/other")).toBeNull();
    expect(parseRoute("/widget/frontdoor/%E0%A4%A/template")).toBeNull();
    expect(parseRoute("/hub/x/state/template")).toBeNull();
  });

  it("decodes percent-encoded ids", () => {
    expect(parseRoute("/widget/caf%C3%A9%2Fbar")).toEqual({
      view: "widget",
      slug: "café/bar",
    });
  });

  it("treats a segment that is not valid percent-encoding as unrecognized", () => {
    // decodeURIComponent throws on it; a typo in a link must not become
    // the boot-error card.
    expect(parseRoute("/widget/%E0%A4%A")).toBeNull();
    expect(parseRoute("/activity/%")).toBeNull();
  });

  it("parses the activity log's path, and nothing under it", () => {
    expect(parseRoute("/log")).toEqual({ view: "log" });
    expect(parseRoute("/log/")).toEqual({ view: "log" });
    expect(parseRoute("/log/x")).toBeNull();
    expect(formatRoute({ view: "log" })).toBe("/log");
  });

  it("rejects unrecognized paths", () => {
    expect(parseRoute("/nope")).toBeNull();
    expect(parseRoute("/widget")).toBeNull();
    expect(parseRoute("/widget/")).toBeNull();
    expect(parseRoute("/widget/a/b")).toBeNull();
    expect(parseRoute("/widgets/a")).toBeNull();
  });
});

describe("formatRoute", () => {
  it("round-trips every view, encoding the id", () => {
    expect(formatRoute({ view: "hub" })).toBe("");
    expect(formatRoute({ view: "widget", slug: "frontdoor" })).toBe("/widget/frontdoor");
    expect(formatRoute({ view: "activity", slug: "washer" })).toBe("/activity/washer");
    const weird = { view: "widget", slug: "café/bar" } as const;
    expect(parseRoute(formatRoute(weird))).toEqual(weird);
    expect(formatRoute({ view: "widget", slug: "frontdoor", template: "state" })).toBe(
      "/widget/frontdoor/state/template",
    );
    const box = { view: "activity", slug: "washer", template: "segments.0.source" } as const;
    expect(parseRoute(formatRoute(box))).toEqual(box);
  });
});
