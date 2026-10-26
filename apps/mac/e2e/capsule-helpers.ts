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

/** What a problem card says: its title; the lines of its body, each whole (a string) or matched (a regular expression); the label of its one fix; the part of the body set in code. */
export interface ProblemCard {
  title: string;
  lines?: (string | RegExp)[];
  fix?: string;
  command?: string;
}

/**
 * The capsule shows a problem: one notice in the `alert` role (Zel worried, and no card or bar with it), headed `title`, with the
 * lines of its body under it, and its buttons: Hide first, quiet, and then the fix when there is one, the moment's one primary. All
 * small, and the notice inside the panel. Returns the notice.
 */
export async function expectProblem(capsule: Page, { title, lines = [], fix, command }: ProblemCard): Promise<Locator> {
  const alert = capsule.getByRole("alert");
  await expect(alert).toHaveCount(1);
  await expect(capsule.getByRole("status")).toHaveCount(0);
  await expect(capsule.getByRole("article")).toHaveCount(0);
  await expect(alert.getByText(title, { exact: true })).toBeVisible();
  for (const line of lines) await expect(typeof line === "string" ? alert.getByText(line, { exact: true }) : alert.getByText(line)).toBeVisible();
  // A command is in the code face, as the windows set it, and nothing else is.
  if (command === undefined) await expect(alert.locator("code")).toHaveCount(0);
  else await expect(alert.locator("code")).toHaveText(command);
  await expect(zel(capsule)).toHaveAttribute("data-mood", "needs-you");
  const buttons = alert.getByRole("button");
  expect(await namesOf(buttons)).toEqual(fix === undefined ? ["Hide"] : ["Hide", fix]);
  await expect(buttons.first()).toHaveAttribute("data-variant", "quiet");
  if (fix !== undefined) await expect(buttons.last()).toHaveAttribute("data-variant", "primary");
  for (const button of await buttons.all()) await expect(button).toHaveAttribute("data-size", "small");
  const box = (await alert.boundingBox())!;
  const panel = await capsule.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(panel.width);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(panel.height);
  return alert;
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
