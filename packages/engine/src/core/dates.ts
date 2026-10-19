// Every date in the library is local time: capture ids, log lines, frontmatter, folder names.

function pad(value: number, width = 2): string {
  return String(value).padStart(width, "0");
}

/** "2026-10-20" */
export function localDate(date: Date): string {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** "2026-10-20 14:03", the log.md stamp */
export function localMinute(date: Date): string {
  return `${localDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** "2026-10-20-140312", the stem of capture ids and recording names */
export function idStamp(date: Date): string {
  return `${localDate(date)}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

/** "2026-10-20T14:03:12+04:00": seconds precision with the local UTC offset. */
export function isoLocal(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset < 0 ? "-" : "+";
  const minutes = Math.abs(offset);
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  return `${localDate(date)}T${time}${sign}${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** ["2026", "10"]: the year/month folders captures, recordings and screenshots are kept in. */
export function yearMonth(date: Date): [string, string] {
  return [pad(date.getFullYear(), 4), pad(date.getMonth() + 1)];
}
