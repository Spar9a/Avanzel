// Which shadow tasks should run now. A task seen for the first time is only remembered, so a
// fresh install never fires yesterday's run; a run missed while the Mac slept happens once.

export interface SchedulableTask {
  id: string;
  schedule: string;
  enabled: boolean;
}

export function dueTasks(
  tasks: SchedulableTask[],
  lastRuns: Record<string, string>,
  now: Date,
  lastDue: (schedule: string, now: Date) => Date,
): { due: string[]; baseline: string[] } {
  const due: string[] = [];
  const baseline: string[] = [];
  for (const task of tasks) {
    if (!task.enabled) continue;
    const last = lastRuns[task.id];
    if (!last) {
      baseline.push(task.id);
      continue;
    }
    if (new Date(last).getTime() < lastDue(task.schedule, now).getTime()) due.push(task.id);
  }
  return { due, baseline };
}

/** Per library (kept by `RunStateStore`): when each task was last checked for being due, and last ran. */
export interface RunState {
  checked: Record<string, string>;
  ran: Record<string, string>;
}

const stringRecord = (value: unknown): Record<string, string> =>
  typeof value === "object" && value !== null
    ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    : {};

export function normalizeRunState(raw: unknown): RunState {
  const r = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  if ("checked" in r || "ran" in r) return { checked: stringRecord(r.checked), ran: stringRecord(r.ran) };
  const legacy = stringRecord(r.lastRun);
  return { checked: { ...legacy }, ran: { ...legacy } };
}

export function markChecked(state: RunState, ids: string[], now: Date): RunState {
  const checked = { ...state.checked };
  for (const id of ids) checked[id] = now.toISOString();
  return { checked, ran: { ...state.ran } };
}

export function markRan(state: RunState, id: string, now: Date): RunState {
  const at = now.toISOString();
  return { checked: { ...state.checked, [id]: at }, ran: { ...state.ran, [id]: at } };
}
