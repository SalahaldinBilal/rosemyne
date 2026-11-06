const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}

// Clock style for video lengths: 0:42, 3:07, 1:02:05.
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`;
}

// Spelled out for filter pills: 1m 30s, 2h, 0s.
export function formatDuration(ms: number): string {
  const parts: string[] = [];
  let rest = Math.max(0, Math.round(ms));
  for (const [unit, size] of [["h", 3_600_000], ["m", 60_000], ["s", 1_000], ["ms", 1]] as const) {
    const value = Math.floor(rest / size);
    rest -= value * size;
    if (value > 0) parts.push(`${value}${unit}`);
  }
  return parts.join(" ") || "0s";
}

export function formatShortDate(ms: number): string {
  const date = new Date(ms);
  return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]} ${date.getFullYear()}`;
}
