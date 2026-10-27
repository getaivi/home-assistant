import { setTimeout as sleep } from "node:timers/promises";
import { expect, test } from "./fixtures";
import type { FlowResult } from "./home-assistant";
import { laundryPushWith } from "./mock-aivi";

/** Fail unless `read` keeps answering `expected` for `ms`: the one fixed
 * window in the suite, for asserting that something does not happen. */
async function holds<T>(
  what: string,
  read: () => Promise<T>,
  expected: T,
  ms: number,
): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    expect(await read(), what).toBe(expected);
    await sleep(500);
  }
}

test.describe("subscription", () => {
  test.afterEach(async ({ mock }) => {
    await mock.setSubscription({ active: true });
  });

  // The first 402 (a push) pauses the whole account: one repair issue, the
  // panel banner, and no more calls to Aivi while state keeps changing.
  // Renewed, the repair flow's Check again resumes it at once (the hourly
  // check is not waited for). Idempotent: a retry finds the account paused.
  test("a lapse pauses the account; Check again resumes it", async ({
    ha,
    mock,
    panel,
  }, testInfo) => {
    const value = 81 + testInfo.retry;
    await mock.setSubscription({ active: false, expired_at: "2026-09-01T00:00:00Z" });
    await ha.setWasherProgress(value);

    const issue =
      await test.step("the lapse raises one repair issue and the panel banner", async () => {
        await expect
          .poll(() => ha.subscriptionIssue(), {
            message: "the subscription repair issue",
            timeout: 30_000,
          })
          .toBeDefined();
        const issue = await ha.subscriptionIssue();
        if (!issue) throw new Error("the subscription repair issue went away");
        expect(issue.translation_placeholders?.["expired"]).toBe("2026-09-01");
        await panel.open(panel.subscriptionBanner);
        expect(
          await panel.unreachableBanner.isVisible(),
          "a lapse is not shown as Aivi being unreachable",
        ).toBe(false);
        await expect
          .poll(
            async () => {
              const stream = await ha.eventStream();
              return { state: stream?.state, reason: stream?.attributes["reason"] };
            },
            { message: "the Event stream sensor says paused", timeout: 60_000 },
          )
          .toEqual({ state: "off", reason: "subscription_inactive" });
        return issue;
      });

    await test.step("state changes while paused do not reach Aivi", async () => {
      const before = await mock.answered402();
      await ha.setWasherProgress(value + 5);
      await ha.setWasherProgress(value + 10);
      await holds(
        "no calls to Aivi while the account is paused",
        () => mock.answered402(),
        before,
        5_000,
      );
    });

    await test.step("renewed, Check again resumes pushes and the event stream", async () => {
      await mock.setSubscription({ active: true });
      const flow = await ha.api<FlowResult>("POST", "/api/repairs/issues/fix", {
        handler: "aivi",
        issue_id: issue.issue_id,
      });
      expect(flow, "the repair flow starts at its confirmation").toMatchObject({
        type: "form",
        step_id: "confirm",
      });
      const done = await ha.api<FlowResult>("POST", `/api/repairs/issues/fix/${flow.flow_id}`, {});
      expect(done.type, "Check again resumes the account").toBe("create_entry");

      await expect
        .poll(() => mock.findPush(laundryPushWith(value + 10)), {
          message: `the progress set while paused is pushed (${value + 10})`,
          timeout: 30_000,
        })
        .toBeDefined();
      // A press only reaches Home Assistant over a live stream.
      await expect
        .poll(
          async () => {
            await mock.pressTile("porch", "input_boolean_porch_light", false);
            return (await ha.state("input_boolean.porch_light")).state;
          },
          {
            message: "the event stream reconnects and plays a press back",
            timeout: 30_000,
            intervals: [1_000],
          },
        )
        .toBe("off");
      await expect
        .poll(() => ha.subscriptionIssue(), {
          message: "the repair issue clears",
          timeout: 60_000,
        })
        .toBeUndefined();
      await panel.open(panel.laundryCard);
      expect(
        await panel.subscriptionBanner.isVisible(),
        "the subscription banner leaves after renewal",
      ).toBe(false);
    });
  });
});
