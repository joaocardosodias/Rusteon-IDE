import { useMemoryStore, MemorySnapshot } from '../store/useMemoryStore';

function fmt(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function fmtShort(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${bytes}B`;
}

// ── Big Radial Gauge ─────────────────────────────────────────────────────────
function RadialGauge({ ratio, label, value, color, glowColor, gradId }: {
  ratio: number; label: string; value: string;
  color: string; glowColor: string; gradId: string;
}) {
  const SIZE = 120;
  const cx = SIZE / 2, cy = SIZE / 2, R = 48, SW = 9;
  const START = -215 * (Math.PI / 180);
  const SWEEP = 250 * (Math.PI / 180);
  const clamp = Math.min(1, Math.max(0, ratio));
  const endAngle = START + SWEEP * clamp;
  const largeArc = SWEEP * clamp > Math.PI ? 1 : 0;

  const pt = (a: number) => ({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
  const s = pt(START), te = pt(START + SWEEP), ae = pt(endAngle);

  return (
    <div className="mem2-gauge-wrap">
      <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={color} stopOpacity="0.6" />
            <stop offset="100%" stopColor={color} />
          </linearGradient>
          <filter id={`glow-${gradId}`}>
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Background track */}
        <path
          d={`M ${s.x} ${s.y} A ${R} ${R} 0 1 1 ${te.x} ${te.y}`}
          fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={SW} strokeLinecap="round"
        />
        {/* Filled arc */}
        {clamp > 0 && (
          <path
            d={`M ${s.x} ${s.y} A ${R} ${R} 0 ${largeArc} 1 ${ae.x} ${ae.y}`}
            fill="none" stroke={`url(#${gradId})`} strokeWidth={SW} strokeLinecap="round"
            filter={`url(#glow-${gradId})`}
            style={{ filter: `drop-shadow(0 0 6px ${glowColor})` }}
          />
        )}

        {/* Inner value */}
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize="15" fontWeight="800"
          fill="white" fontFamily="'JetBrains Mono', monospace" letterSpacing="-0.5">{value}</text>
        <text x={cx} y={cy + 10} textAnchor="middle" fontSize="9" fill="rgba(255,255,255,0.4)"
          fontFamily="inherit" letterSpacing="0.08em" textDecoration="uppercase">{label}</text>
        <text x={cx} y={cy + 22} textAnchor="middle" fontSize="8.5" fill={color}
          fontFamily="inherit">{Math.round(clamp * 100)}%</text>
      </svg>
    </div>
  );
}

// ── Metric Card ──────────────────────────────────────────────────────────────
function MetricCard({ label, value, sub, color, icon }: {
  label: string; value: string; sub?: string; color: string; icon: string;
}) {
  return (
    <div className="mem2-card" style={{ borderColor: `${color}22` }}>
      <div className="mem2-card-icon" style={{ color }}>{icon}</div>
      <div className="mem2-card-body">
        <div className="mem2-card-value" style={{ color }}>{value}</div>
        <div className="mem2-card-label">{label}</div>
        {sub && <div className="mem2-card-sub">{sub}</div>}
      </div>
    </div>
  );
}

// ── Sparkline ────────────────────────────────────────────────────────────────
function Sparkline({ history }: { history: MemorySnapshot[] }) {
  if (history.length < 3) return null;
  const W = 340, H = 44, pad = 4;
  const total = history[0].total || 1;
  const freeVals = history.map(s => s.free);
  const maxF = Math.max(...freeVals, 1);
  const minF = Math.min(...freeVals);
  const range = maxF - minF || 1;

  const pts = history.map((s, i) => {
    const x = pad + (i / (history.length - 1)) * (W - pad * 2);
    const y = H - pad - ((s.free - minF) / range) * (H - pad * 2);
    return `${x},${y}`;
  }).join(' ');

  const areaBot = history.map((_, i, arr) => {
    const x = pad + (i / (arr.length - 1)) * (W - pad * 2);
    return `${x},${H}`;
  });
  const areaPath = `M ${pad},${H} ${pts.split(' ').map((p, i) => `L ${p}`).join(' ')} L ${W - pad},${H} Z`;

  const latest = history[history.length - 1];
  const freeRatio = latest.free / total;

  return (
    <div className="mem2-spark-wrap">
      <div className="mem2-spark-header">
        <span className="mem2-spark-label">Free RAM History</span>
        <span className="mem2-spark-range">{fmtShort(minF)} – {fmtShort(maxF)}</span>
      </div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ display: 'block' }}>
        <defs>
          <linearGradient id="spark-area-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#50fa7b" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#50fa7b" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#spark-area-grad)" />
        <polyline
          points={pts}
          fill="none"
          stroke="#50fa7b"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ filter: 'drop-shadow(0 0 4px #50fa7b88)' }}
        />
        {/* Current point */}
        {history.length > 0 && (() => {
          const last = history[history.length - 1];
          const x = W - pad;
          const y = H - pad - ((last.free - minF) / range) * (H - pad * 2);
          return (
            <circle cx={x} cy={y} r="3" fill="#50fa7b"
              style={{ filter: 'drop-shadow(0 0 4px #50fa7b)' }} />
          );
        })()}
      </svg>
    </div>
  );
}

// ── Usage Bar ─────────────────────────────────────────────────────────────────
function UsageBar({ heapR, stackR, freeR }: { heapR: number; stackR: number; freeR: number }) {
  return (
    <div className="mem2-bar-outer">
      <div className="mem2-bar-track">
        <div className="mem2-bar-seg" style={{
          width: `${heapR * 100}%`,
          background: 'linear-gradient(90deg, #8be9fd88, #8be9fd)',
        }} />
        <div className="mem2-bar-seg" style={{
          width: `${stackR * 100}%`,
          background: 'linear-gradient(90deg, #ff79c688, #ff79c6)',
        }} />
        <div className="mem2-bar-seg" style={{
          width: `${freeR * 100}%`,
          background: 'linear-gradient(90deg, #50fa7b44, #50fa7b22)',
        }} />
      </div>
      <div className="mem2-bar-legend">
        <span><span className="mem2-dot" style={{ background: '#8be9fd' }} />Heap</span>
        <span><span className="mem2-dot" style={{ background: '#ff79c6' }} />Stack</span>
        <span><span className="mem2-dot" style={{ background: '#50fa7b' }} />Free</span>
      </div>
    </div>
  );
}

// ── Main Export ───────────────────────────────────────────────────────────────
export function MemoryDashboard() {
  const { latest, history, active } = useMemoryStore();

  if (!active || !latest) {
    return (
      <div className="mem2-empty">
        <div className="mem2-empty-icon">📡</div>
        <div className="mem2-empty-title">No Telemetry Data</div>
        <div className="mem2-empty-sub">Add this to your firmware loop:</div>
        <pre className="mem2-empty-code">{`println!("__RUSTEON_MEM__:{{\\"h\\":0,\\"s\\":0,\\"f\\":60000}}")`}</pre>
        <div className="mem2-empty-sub" style={{ marginTop: 4, fontSize: 10.5 }}>
          Connect Serial Monitor to start receiving data
        </div>
      </div>
    );
  }

  const total = latest.total || 1;
  const heapR = latest.heap / total;
  const stackR = latest.stack / total;
  const freeR = latest.free / total;
  const usedPct = Math.round(((latest.heap + latest.stack) / total) * 100);

  return (
    <div className="mem2-root">
      {/* Header */}
      <div className="mem2-header">
        <div className="mem2-header-left">
          <span className="mem2-title">Live Memory</span>
          <span className="mem2-subtitle">ESP32 · RAM Monitor</span>
        </div>
        <div className="mem2-live-badge">
          <span className="mem2-live-dot" />
          LIVE
        </div>
      </div>

      {/* Main content */}
      <div className="mem2-body">
        {/* Left: Big radial gauge (free%) */}
        <div className="mem2-left">
          <RadialGauge
            ratio={freeR}
            label="FREE"
            value={fmtShort(latest.free)}
            color="#50fa7b"
            glowColor="#50fa7b66"
            gradId="free-rad"
          />
          <div className="mem2-used-label">
            <span style={{ color: '#ff79c6' }}>{usedPct}%</span> used of {fmtShort(total)}
          </div>
        </div>

        {/* Right: Cards */}
        <div className="mem2-right">
          <MetricCard
            icon="◈" label="Heap" value={fmt(latest.heap)}
            sub={`${Math.round(heapR * 100)}% of total`} color="#8be9fd"
          />
          <MetricCard
            icon="◇" label="Stack" value={fmt(latest.stack)}
            sub={`${Math.round(stackR * 100)}% of total`} color="#ff79c6"
          />
          <MetricCard
            icon="◉" label="Free" value={fmt(latest.free)}
            sub={`${Math.round(freeR * 100)}% available`} color="#50fa7b"
          />
          <MetricCard
            icon="▣" label="Total RAM" value={fmt(total)}
            color="#6272a4"
          />
        </div>
      </div>

      {/* Usage bar */}
      <UsageBar heapR={heapR} stackR={stackR} freeR={freeR} />

      {/* Sparkline */}
      <Sparkline history={history} />
    </div>
  );
}
