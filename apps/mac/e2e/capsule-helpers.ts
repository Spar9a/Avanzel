// What the specs of the capsule's cards share: how a card is read, and what the two Stopped cards show.
import { expect, type Locator, type Page } from "@playwright/test";
import { zel } from "./setup-helpers.ts";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Today as a stamp prints it, "27 Oct 2026" (the page words it with stampDate): the stamp's name carries it. */
export function stampDay(): string {
  const day = new Date();
  return `${day.getDate()} ${MONTHS[day.getMonth()]} ${day.getFullYear()}`;
}

/** The names of `buttons`, in order: a button's label when it has only an icon, else its words. */
export const namesOf = (buttons: Locator) => buttons.evaluateAll((all) => all.map((button) => button.getAttribute("aria-label") ?? button.textContent?.trim() ?? ""));

/** The card and the bar fit the panel: the card is below its top and above the bar, and the bar is no lower than its bottom. */
export async function expectInPanel(capsule: Page): Promise<void> {
  const card = (await capsule.getByRole("article").boundingBox())!;
  const bar = (await capsule.getByRole("status").boundingBox())!;
  const panel = await capsule.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  expect(card.y).toBeGreaterThanOrEqual(8);
  expect(card.y + card.height).toBeLessThanOrEqual(bar.y);
  expect(bar.y + bar.height).toBeLessThanOrEqual(panel.height);
  expect(card.x).toBeGreaterThanOrEqual(0);
  expect(card.x + card.width).toBeLessThanOrEqual(panel.width);
}

/** The capsule shows a Stopped filing: "Stopped" in the bar, which offers Hide alone, over the words and `line`, what is safe. */
export async function expectStoppedFiling(capsule: Page, words: string, line: string): Promise<void> {
  const bar = capsule.getByRole("status");
  const card = capsule.getByRole("article");
  await expect(bar.getByText("Stopped", { exact: true })).toBeVisible();
  await expect(zel(capsule)).toHaveAttribute("data-mood", "filed");
  expect(await namesOf(bar.getByRole("button"))).toEqual(["Hide"]);
  await expect(card.getByText(words, { exact: true })).toBeVisible();
  await expect(card.getByText(line, { exact: true })).toBeVisible();
  await expect(card).not.toHaveAttribute("data-stamped"); // a stopped filing is not stamped
  await expectInPanel(capsule);
}

/** The capsule shows a Stopped transcription: "Stopped" in the bar, which offers Hide alone, over a card with no words and `line`. */
export async function expectStoppedRecording(capsule: Page, line: string): Promise<void> {
  const bar = capsule.getByRole("status");
  const card = capsule.getByRole("article");
  await expect(bar.getByText("Stopped", { exact: true })).toBeVisible();
  await expect(zel(capsule)).toHaveAttribute("data-mood", "filed");
  expect(await namesOf(bar.getByRole("button"))).toEqual(["Hide"]);
  await expect(card.getByText("Recording", { exact: true })).toBeVisible();
  await expect(card.getByText("Your recording", { exact: true })).toBeVisible(); // the empty card's placeholder
  await expect(card.getByText(line, { exact: true })).toBeVisible();
  await expect(card).not.toHaveAttribute("data-stamped");
  await expectInPanel(capsule);
}
