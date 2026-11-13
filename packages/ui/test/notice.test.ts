// A Notice's buttons are a group named by its title, so two notices with the same buttons (two shelves suggested, each with Make shelf
// and No) are told apart: VoiceOver reads "Make shelf, Make a shelf called Projects?, group".
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Actions, Button, Notice, Stack } from "../src/index.ts";

const notice = (title: string) =>
  createElement(Notice, {
    title,
    actions: createElement(Actions, null, createElement(Button, { variant: "quiet", children: "No" }), createElement(Button, { variant: "primary", children: "Make shelf" })),
  });

/** The id the title carries, and the group's aria-labelledby, in one notice's markup. */
function ids(markup: string): { title?: string; group?: string } {
  return {
    title: /<p class="av-notice-title" id="([^"]+)"/.exec(markup)?.[1],
    group: /role="group" aria-labelledby="([^"]+)"/.exec(markup)?.[1],
  };
}

describe("Notice", () => {
  it("puts its actions in a group labelled by its title", () => {
    const markup = renderToStaticMarkup(notice("Make a shelf called Projects?"));
    const { title, group } = ids(markup);
    expect(title).toBeTruthy();
    expect(group).toBe(title);
    // The buttons are inside the group, and the title is not.
    const inGroup = markup.slice(markup.indexOf('role="group"'));
    expect(inGroup).toContain(">Make shelf<");
    expect(inGroup).not.toContain("Make a shelf called Projects?");
  });

  it("gives each notice its own title id, so two of them name their groups apart", () => {
    const markup = renderToStaticMarkup(createElement(Stack, null, notice("Make a shelf called Projects?"), notice("Make a shelf called Errands?")));
    const titles = [...markup.matchAll(/<p class="av-notice-title" id="([^"]+)"/g)].map(([, id]) => id);
    const groups = [...markup.matchAll(/role="group" aria-labelledby="([^"]+)"/g)].map(([, id]) => id);
    expect(titles).toHaveLength(2);
    expect(new Set(titles).size).toBe(2);
    expect(groups).toEqual(titles);
  });

  it("has no group when it has no actions", () => {
    expect(renderToStaticMarkup(createElement(Notice, { title: "Claude Code isn't signed in on this Mac." }))).not.toContain('role="group"');
  });
});
