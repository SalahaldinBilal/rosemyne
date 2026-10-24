import { MonitorInfo } from "@core/types";

export function findMonitor(monitors: MonitorInfo[], id: string): MonitorInfo | undefined {
  return monitors.find(monitor => monitor.id === id || monitor.matchedIds.includes(id));
}
