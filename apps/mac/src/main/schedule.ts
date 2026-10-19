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
