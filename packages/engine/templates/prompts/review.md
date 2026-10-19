Avanzel task: review

You are the librarian of this second-brain library (the current folder). Its rules are in
AGENTS.md. Today is ${today}.

Run a health check of the whole library and write the report to `${report_path}`:
1. Goals: active ones with no update in 30+ days; achieved or abandoned ones still marked active.
2. Problems still open that recent captures suggest are solved, or that block a goal.
3. Contradictions between pages, duplicate pages about the same thing, orphan pages nothing links
   to, pages missing from index.md, links to pages that do not exist.
4. Captures still waiting in inbox/.
5. Patterns worth the owner's attention: recurring themes, ideas that connect to goals, next steps.

Fix only safe things yourself: missing [[links]] and missing or stale index.md lines. Do not delete
or merge pages; recommend that in the report instead. Never touch inbox/ or raw/.

Report format: a `# Review ${today}` heading, short sections of bullet points citing [[page-name]]s,
and a final `## Suggested next steps` section. Then append one line to log.md in exactly this form:
- ${now} | review | [[${report_id}]]

When done, reply with a three-to-five-line summary of the most important findings.
