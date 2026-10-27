import { useEffect } from "react";
import { createStore } from "../lib/store";
import { inTauri, ipc, type SystemStats } from "../lib/ipc";
import { ChipIcon } from "../components/Icons";
import type { ActivityModule } from "./types";

/** Latest CPU and memory sample. */
const store = createStore<SystemStats | null>(null);

/** Bytes in one gibibyte. */
const GB = 1024 ** 3;

/**
 * Formats a transfer rate.
 *
 * @param bytesPerSecond Rate in bytes per second.
 * @returns For example `850 KB/s` or `1.2 MB/s`.
 */
function formatRate(bytesPerSecond: number): string {
  const kb = bytesPerSecond / 1024;
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB/s` : `${Math.round(kb)} KB/s`;
}

/** Leading glyph of the compact pill and the tab strip. */
function Glyph({ size = 20 }: { size?: number }) {
  return <ChipIcon size={size} />;
}

/**
 * Labelled progress bar.
 *
 * @param label Name shown on the left and used as the accessible name.
 * @param value Fill in percent, 0-100.
 * @param detail Text shown on the right.
 */
function Meter({ label, value, detail }: { label: string; value: number; detail: string }) {
  const pct = Math.round(value);
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <div className="progress-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <div className="progress-fill" data-hot={pct >= 90} style={{ width: `${pct}%` }} />
      </div>
      <span className="num stat-value">{detail}</span>
    </div>
  );
}

/** Panel shown in the expanded island. CPU, memory, disk and network, sampled once a second while mounted. */
function Expanded() {
  const s = store.use();

  // Samples once a second, and only while this panel is mounted.
  useEffect(() => {
    if (!inTauri) return;
    let alive = true;
    const sample = () => void ipc.systemStats().then((v) => alive && store.set(v)).catch(() => undefined);
    sample();
    const id = window.setInterval(sample, 1000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  const memPct = s && s.memTotal > 0 ? (s.memUsed / s.memTotal) * 100 : 0;
  return (
    <div className="panel panel-stats">
      <Meter label="CPU" value={s?.cpu ?? 0} detail={s ? `${Math.round(s.cpu)}%` : "--"} />
      <Meter
        label="Memory"
        value={memPct}
        detail={s ? `${(s.memUsed / GB).toFixed(1)} of ${(s.memTotal / GB).toFixed(0)} GB` : "--"}
      />
      <Meter
        label="Disk"
        value={s && s.diskTotal > 0 ? (s.diskUsed / s.diskTotal) * 100 : 0}
        detail={s ? `${(s.diskUsed / GB).toFixed(0)} of ${(s.diskTotal / GB).toFixed(0)} GB` : "--"}
      />
      <div className="stat stat-net">
        <span className="stat-label">Network</span>
        <span className="num stat-rate">{s ? `↓ ${formatRate(s.netDown)}` : "--"}</span>
        <span className="num stat-rate">{s ? `↑ ${formatRate(s.netUp)}` : "--"}</span>
      </div>
    </div>
  );
}

/** System activity: CPU and memory load, available as a tab only. */
export const systemStats: ActivityModule = {
  id: "systemStats",
  useActivity(settings) {
    const enabled = settings.activities.systemStats;
    return {
      id: "systemStats",
      label: "System",
      priority: 5,
      live: false,
      available: enabled,
      Glyph,
      Trailing: () => null,
      Expanded,
    };
  },
};
