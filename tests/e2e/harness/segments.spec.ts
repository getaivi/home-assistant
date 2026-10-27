import { center, expect, test } from "./fixtures";

test.describe("bar segments", () => {
  test("a widget bar: solid, segmented, entity-sourced, broken template", async ({
    page,
    panel,
    snapshots,
  }) => {
    const segments = async () => (await panel.payload()).progress?.segments ?? [];
    const sourceMode = (label: string) =>
      page.locator(".seginline .seg[role='radiogroup'] button", { hasText: label });

    await panel.openEditor("index.html#/widget/laundry", "Laundry");
    await panel.pickEntity(
      page.locator('.field[data-key="progress"] input[type="text"]'),
      "washer",
      "input_number.washer_progress",
    );
    await panel.previewReady();

    // The bar-style radiogroup (Solid | Segmented on a widget) gating the
    // fill-color swatches.
    await test.step("Solid shows no segments editor", async () => {
      await expect(panel.barMode("Solid")).toBeVisible();
      await expect(page.locator(".seged .segbar")).toHaveCount(0);
      await snapshots.shot("editor-bar-solid");
    });

    // No Label input on a widget: no widget family shows segment labels
    // on-device.
    await test.step("Segmented seeds 50/50 and opens the first phase", async () => {
      await panel.barMode("Segmented").click();
      await expect(page.locator(".seginline")).toBeVisible();
      await expect(page.locator(".seginline input.lbl")).toHaveCount(0);
      await expect.poll(async () => (await panel.payload()).progress?.style).toBe("segmented");
      await expect.poll(async () => (await segments()).map((s) => s.value)).toEqual([0.5, 0.5]);
      await snapshots.shot("editor-segments");
    });

    // The handle is a slider.
    await test.step("Shift+ArrowRight moves a boundary 5%", async () => {
      await page.locator(".seghandle").first().focus();
      await page.keyboard.press("Shift+ArrowRight");
      await expect.poll(async () => (await segments())[0]?.value).toBeCloseTo(0.55, 2);
    });

    // The bar renders the resolved share, the sourced capsule gets a
    // dashed ring, and the boundary handle renders locked.
    await test.step("an entity-sourced phase resolves its weight and locks its boundary", async () => {
      // Raw mouse coordinates: the bar's single hit overlay owns every
      // pointer event and resolves the capsule under a still tap itself.
      const capsule = await center(page.locator(".segcap").nth(1));
      await page.mouse.click(capsule.x, capsule.y);
      await sourceMode("Entity").click();
      await panel.pickEntity(
        page.locator(".seginline .cbx input"),
        "wash",
        "sensor.wash_remaining",
      );
      // The payload proves the preview resolved the sourced weight (0.6
      // against the literal 0.55, about 0.522) and stripped the source keys.
      await expect.poll(async () => (await segments()).length).toBe(2);
      await expect.poll(async () => (await segments())[1]?.value).toBeCloseTo(0.52, 2);
      expect((await segments())[1]).not.toHaveProperty("source");
      await expect(page.locator(".segcap.src")).toBeVisible();
      await expect(page.locator(".seghandle.locked")).toBeAttached();
      await snapshots.shot("editor-segments-sourced");
    });

    // The hit overlay is not focusable, so the press's default must not
    // take the focus back. The pointer leaves before the release, so the
    // press is neither a drag nor a tap and the selection stays.
    await test.step("a press on the locked boundary gives it the focus", async () => {
      const locked = page.locator(".seghandle.locked");
      const at = await center(locked);
      await page.mouse.move(at.x, at.y);
      await page.mouse.down();
      const focused = await locked.evaluate(
        (el) => (el.getRootNode() as ShadowRoot).activeElement === el,
      );
      await page.mouse.move(at.x + 40, at.y, { steps: 4 });
      await page.mouse.up();
      expect(focused).toBe(true);
    });

    // The fallback keeps the payload valid.
    await test.step("a broken weight template is flagged without blocking Save", async () => {
      await sourceMode("Template").click();
      await page.locator(".seginline aivi-code-editor .cm-content").fill("{% broken");
      await expect(page.locator(".seginline .tnote.error")).toBeVisible();
      await expect(page.locator(".segcap.srcerr")).toBeVisible();
      await expect(panel.save).toBeEnabled();
      await snapshots.shot("editor-segments-feedback");
    });

    // A weight template that works says the size it gave the phase.
    await test.step("a working weight template shows its result and share", async () => {
      await page
        .locator(".seginline aivi-code-editor .cm-content")
        .fill("{{ states('sensor.wash_remaining') | float(0) }}");
      await expect(page.locator(".seginline .tres .tval")).toHaveText("0.6");
      await expect(page.locator(".seginline .tres .tkind")).toHaveText(/^number, \d+% of the bar$/);
      await expect(page.locator(".seginline .tchips .chip")).toHaveText(["sensor.wash_remaining"]);
      await snapshots.shot("editor-segments-template-result");
    });
  });

  test("a Live Activity bar: layered labels and crowded boundaries", async ({
    page,
    panel,
    snapshots,
  }) => {
    const weights = async (): Promise<number[]> =>
      ((await panel.payload()).progress?.segments ?? []).map((s) => s.value);
    // The seam between capsules i and i+1, where a human aims the pointer.
    const seam = (i: number) =>
      page
        .locator(".segbar")
        .first()
        .evaluate((bar, i) => {
          const caps = [...bar.querySelectorAll(".segcap")];
          const a = caps[i]?.getBoundingClientRect();
          const b = caps[i + 1]?.getBoundingClientRect();
          if (!a || !b) throw new Error(`no seam ${i}`);
          return { x: (a.right + b.left) / 2, y: a.top + a.height / 2 };
        }, i);
    const drag = async (from: { x: number; y: number }, toX: number) => {
      await page.mouse.move(from.x, from.y);
      await page.mouse.down();
      await page.mouse.move(toX, from.y, { steps: 6 });
      await page.mouse.up();
    };

    await panel.openEditor("index.html#/activity/washer", "Washer");
    await panel.previewReady();

    // Layered is a bar mode only on the activity surface; choosing it
    // seeds phases too. Phase labels go in the caption row below the bar,
    // where the device puts them, never on the capsules.
    await test.step("phase labels sit below the bar, in the editor and the preview", async () => {
      await panel.barMode("Layered").click();
      await page.locator(".seginline input.lbl").fill("Wash");
      await expect(page.locator(".segcol .barlabels", { hasText: "Wash" })).toBeVisible();
      await expect(page.locator(".segcap", { hasText: "Wash" })).toHaveCount(0);
      // The preview pane renders the layered look too: one capsule-clipped
      // layer stack (no flex capsules, no gap) with the label in the
      // caption row below.
      const caption = page.locator(".pv-banner .barlabels", { hasText: "Wash" }).first();
      await expect(caption).toBeAttached();
      await expect
        .poll(() =>
          caption.evaluate((row) => {
            const bar = row.previousElementSibling;
            if (!(bar instanceof HTMLElement)) return null;
            return {
              position: bar.style.position,
              overflow: bar.style.overflow,
              gap: bar.style.gap,
              labeled: bar.textContent.includes("Wash"),
            };
          }),
        )
        .toEqual({ position: "relative", overflow: "hidden", gap: "", labeled: false });
      await snapshots.shot("editor-segments-layered");
    });

    // With three phases and the last boundary dragged to its 1% minimum,
    // the two seams nearly coincide. The hit overlay resolves the seam
    // nearest the pointer, so boundary 0 must stay draggable at its
    // visual seam.
    await test.step("a crowded boundary stays draggable at its seam", async () => {
      await page.locator(".segadd").click();
      await expect.poll(weights).toHaveLength(3);
      // Crowd: drag the last boundary left until it clamps at the minimum.
      const first = await seam(0);
      await drag(await seam(1), first.x - 80);
      await expect.poll(async () => (await weights())[1]).toBeLessThanOrEqual(0.011);

      const before = (await weights())[0] ?? 0;
      const crowded = await seam(0);
      await drag(crowded, crowded.x - 60);
      await expect.poll(weights).toHaveLength(3);
      await expect.poll(async () => (await weights())[0]).toBeLessThan(before - 0.02);
    });
  });
});
