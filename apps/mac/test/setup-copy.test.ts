import { describe, expect, it } from "vitest";
import { agentLine, agentProblemTitle, cardDate, isAgentProblem, megabytes, ownLine, stampDate } from "../src/renderer/setup/copy.ts";
import type { AgentStatus } from "../src/shared/ipc.ts";

describe("setup copy", () => {
  it("dates read as the card and the stamp print them", () => {
    const day = new Date(2026, 9, 21);
    expect(cardDate(day)).toBe("Wednesday 21 October");
    expect(stampDate(day)).toBe("21 Oct 2026");
    expect(megabytes(672_807_563)).toBe(673);
  });

  it("each status reads as Found says it", () => {
    expect(agentLine(null)).toBe("Installed");
    expect(agentLine({ kind: "checking" })).toBe("Checking…");
    expect(agentLine({ kind: "signed-in", seconds: 0.4 })).toBe("Signed in");
    expect(agentLine({ kind: "replied", seconds: 1.63 })).toBe("Replied in 1.6 s");
    expect(agentLine({ kind: "signed-out", detail: "" })).toBe("Not signed in");
    expect(agentLine({ kind: "timeout" })).toBe("Didn't reply within 15 s.");
    expect(agentLine({ kind: "failed", detail: "Error: boom" })).toBe("Boom.");
    expect(agentLine({ kind: "failed", detail: "" })).toBe("Didn't reply.");
    expect(agentLine({ kind: "failed", detail: "Error:" })).toBe("Didn't reply."); // a label with nothing after it says nothing
  });

  it("a problem the chosen agent's Notice names: signed out, no reply in time, or a failure", () => {
    const statuses: (AgentStatus | null)[] = [
      { kind: "signed-out", detail: "" }, { kind: "timeout" }, { kind: "failed", detail: "boom" },
      { kind: "signed-in", seconds: 0.4 }, { kind: "replied", seconds: 1.6 }, { kind: "checking" }, null,
    ];
    expect(statuses.map(isAgentProblem)).toEqual([true, true, true, false, false, false, false]);
    expect(agentProblemTitle("Claude Code", { kind: "signed-out", detail: "" })).toBe("Claude Code isn't signed in on this Mac.");
    expect(agentProblemTitle("OpenCode", { kind: "timeout" })).toBe("OpenCode didn't reply within 15 s.");
    expect(agentProblemTitle("Codex", { kind: "failed", detail: "Error: boom" })).toBe("Codex didn't work.");
  });

  it("ownLine", () => {
    expect(ownLine("Error: usage limit reached")).toBe("Usage limit reached.");
    expect(ownLine("agent crashed: not logged in")).toBe("Agent crashed: not logged in.");
    expect(ownLine("Is it on?")).toBe("Is it on?");
    expect(ownLine("ERROR: the model is not supported with this account")).toBe("The model is not supported with this account.");
    expect(ownLine("Still starting…")).toBe("Still starting…");
    expect(ownLine("")).toBe("");
  });
});
