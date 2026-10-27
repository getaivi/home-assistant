import { center, expect, test } from "./fixtures";

test.describe("rows editor", () => {
  // The second line, the gradient (with its swatch), the picture URL with
  // its size guidance and an inline error, which holds Save.
  test("switchboard tile options hold Save on a bad picture URL", async ({
    page,
    panel,
    snapshots,
  }) => {
    await panel.openEditor("index.html#/widget/livingroom", "Living room");
    await panel.addRow("Movie night");
    await page
      .locator(".ordrow", { hasText: "Movie night" })
      .getByRole("button", { name: /^Movie night\b/ })
      .click();
    // The gradient builder: Custom, then a hex for each of its two stops.
    await page.locator(".rowopts details.fold", { hasText: "Gradient" }).locator("summary").click();
    await page
      .locator(".rowopts aivi-gradient-field")
      .getByRole("radio", { name: "Custom" })
      .click();
    for (const [i, hex] of ["#3D3DFF", "#A64BFF"].entries()) {
      const stop = page.locator(".rowopts .gstop aivi-color-field").nth(i);
      await stop.locator(".cfbtn").click();
      await stop.locator("input[aria-label$='hex code']").fill(hex);
      await page.keyboard.press("Escape");
    }
    await page.locator(".rowopts details.fold", { hasText: "Picture" }).locator("summary").click();
    await page
      .locator(".rowopts input[aria-label^='Picture URL']")
      .fill("http://example.com/movie.png");
    await expect(page.locator(".rowopts .tnote.error")).toBeVisible();
    await expect(panel.payloadText).toContainText("#A64BFF");
    await expect(panel.save).toBeDisabled();
    await page.locator(".rowopts").evaluate((el) => el.scrollIntoView({ block: "center" }));
    await snapshots.shot("editor-switchboard-tile");
  });

  test("rows reorder by keyboard and by drag", async ({ page, panel, snapshots }) => {
    const lock = page.locator(".ordrow", { hasText: "Door lock battery" });
    const vacuum = page.locator(".ordrow", { hasText: "Robot vacuum battery" });
    const firstTwo = async (): Promise<string[]> =>
      ((await panel.payload()).devices ?? []).slice(0, 2).map((d) => d.name);

    // The ordered strip's reorder affordances and an opened row options
    // disclosure with an icon and color set.
    await panel.openEditor("index.html#/widget/batteries", "Home batteries");
    await panel.addRow("Door lock battery");
    await panel.addRow("Robot vacuum battery");
    await panel.previewReady();
    await lock.getByRole("button", { name: /^Door lock battery\b/ }).click();
    await page.locator(".rowopts input[aria-label^='Icon']").fill("lock.fill");
    // Typing opened the symbol picker over the controls below; leave it.
    await page.keyboard.press("Escape");
    await page.locator(".rowopts .cfbtn").click();
    await page.locator(".rowopts .cfpop button[aria-label='Teal']").click();
    await expect(panel.payloadText).toContainText("lock.fill");
    await expect(panel.payloadText).toContainText("teal");
    await snapshots.shot("editor-rows");

    await test.step("Alt+ArrowDown on the grip moves the row and the payload order", async () => {
      await lock.locator(".grip").focus();
      await page.keyboard.press("Alt+ArrowDown");
      await expect.poll(firstTwo).toEqual(["Robot vacuum battery", "Door lock battery"]);
    });

    // The grabbed row lifts into a ghost, a dashed placeholder marks its
    // origin, and an insertion line marks the drop gap. Captured mid-drag
    // (safe: the affordances are transition-free). The order is
    // [vacuum, lock] after the keyboard step, so dragging the vacuum row
    // down one gap flips it back.
    await test.step("a drag lifts the row, marks the gap and drops it there", async () => {
      const grip = await center(vacuum.locator(".grip"));
      const nextMiddle = (await center(lock)).y;
      const lifted = page.locator(".ordrow.draglift");
      const slot = page.locator(".dragslot");
      const line = page.locator(".dragline");

      await page.mouse.move(grip.x, grip.y);
      await page.mouse.down();
      // A press that wobbles is not a drag: nothing lifts.
      await page.mouse.move(grip.x, grip.y + 3);
      await expect(lifted).toHaveCount(0);
      // Short of the next row's middle the row is lifted, but would drop
      // where it came from: no insertion line yet.
      await page.mouse.move(grip.x, nextMiddle - 4, { steps: 4 });
      await expect(lifted).toBeVisible();
      await expect(slot).toBeVisible();
      await expect(line).toHaveCount(0);
      await page.mouse.move(grip.x, nextMiddle + 4, { steps: 2 });
      await expect(line).toBeVisible();
      await snapshots.shot("editor-rows-drag");
      await page.mouse.up();

      // Every drag artifact is gone once the pointer lifts.
      await expect(page.locator(".draglift")).toHaveCount(0);
      await expect(slot).toHaveCount(0);
      await expect(line).toHaveCount(0);
      // Focus follows the dropped row, on its grip.
      await expect(vacuum.locator(".grip")).toBeFocused();
      await expect.poll(firstTwo).toEqual(["Door lock battery", "Robot vacuum battery"]);
    });
  });

  // The rows checklist over the toggleable and pressable entities, and the
  // preview's tile grid once four are ticked (the porch light on, the
  // fountain off, the movie scene, the running bedtime script
  // highlighted): Medium's 2x3 first, the size the preview opens at, then
  // Small's 2x2.
  test("switchboard tiles at both sizes", async ({ page, panel, snapshots }) => {
    await panel.openEditor("index.html#/widget/livingroom", "Living room");
    for (const name of ["Porch light", "Garden fountain", "Movie night", "Bedtime"]) {
      await panel.addRow(name);
    }
    await expect(
      page.locator(".pv-switchboard-grid .pv-switchboard-tile.is-on").nth(1),
    ).toBeVisible();
    await snapshots.shotWithPreview("editor-switchboard");
    await panel.previewSize("Small");
    await snapshots.shotWithPreview("editor-switchboard-small");
  });
});
