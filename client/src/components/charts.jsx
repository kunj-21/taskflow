import { useLayoutEffect, useMemo, useRef, useState } from 'react';

/* Hand-rolled SVG charts following the dataviz method:
   one y-axis, 2px lines, 4px rounded data-ends, 2px surface gaps between stacked fills,
   recessive grid, legend for >= 2 series, hover tooltips, and a table view for every chart. */

function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

// Round the axis max up to a "nice" number and return ~4 evenly spaced ticks.
function niceTicks(max, count = 4) {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw);
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
}

export function Legend({ items }) {
  return (
    <ul className="viz-legend" aria-label="Legend">
      {items.map((it) => (
        <li key={it.label}><span className="viz-swatch" style={{ background: it.color }} aria-hidden="true" />{it.label}</li>
      ))}
    </ul>
  );
}

export function DataTable({ caption, columns, rows }) {
  return (
    <div className="table-scroll viz-table">
      <table>
        <caption className="sr-only">{caption}</caption>
        <thead><tr>{columns.map((c) => <th key={c.key} scope="col" style={c.numeric ? { textAlign: 'right' } : undefined}>{c.label}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{columns.map((c) => <td key={c.key} className={c.numeric ? 'num' : undefined} style={c.numeric ? { textAlign: 'right' } : undefined}>{r[c.key]}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* Card wrapper with a Chart / Table toggle so the data is never color- or hover-only. */
export function ChartCard({ title, subtitle, table, children, actions }) {
  const [view, setView] = useState('chart');
  return (
    <section className="card viz-card" aria-label={title}>
      <header className="viz-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        <div className="viz-actions">
          {actions}
          <div className="chip-toggle" role="group" aria-label={`${title} view`}>
            <button type="button" aria-pressed={view === 'chart'} onClick={() => setView('chart')}>Chart</button>
            <button type="button" aria-pressed={view === 'table'} onClick={() => setView('table')}>Table</button>
          </div>
        </div>
      </header>
      {view === 'chart' ? children : table}
    </section>
  );
}

/* ---------------- Line chart with crosshair + tooltip ---------------- */
export function LineChart({ data, xKey, series, height = 260, formatX, summary }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const m = { top: 16, right: 16, bottom: 28, left: 36 };
  const w = Math.max(0, width - m.left - m.right);
  const h = height - m.top - m.bottom;

  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => d[s.key])));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const x = (i) => (data.length <= 1 ? w / 2 : (i / (data.length - 1)) * w);
  const y = (v) => h - (v / top) * h;
  const path = (key) => data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join('');

  // Show ~6 x labels regardless of range.
  const every = Math.max(1, Math.ceil(data.length / 6));

  function onMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left - m.left;
    const i = Math.round((px / Math.max(1, w)) * (data.length - 1));
    setHover(Math.min(data.length - 1, Math.max(0, i)));
  }

  const hv = hover != null ? data[hover] : null;
  const tipLeft = hover != null ? Math.min(Math.max(m.left + x(hover), 90), width - 90) : 0;

  return (
    <div ref={ref} className="viz-plot" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={summary}
          onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
          <g transform={`translate(${m.left},${m.top})`}>
            {ticks.map((t) => (
              <g key={t} transform={`translate(0,${y(t)})`}>
                <line x2={w} className="viz-grid" />
                <text x={-8} dy="0.32em" textAnchor="end" className="viz-tick">{t}</text>
              </g>
            ))}
            {data.map((d, i) => (i % every === 0 || i === data.length - 1) && (
              <text key={d[xKey]} x={x(i)} y={h + 18} textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'} className="viz-tick">
                {formatX(d[xKey])}
              </text>
            ))}
            {series.map((s) => (
              <path key={s.key} d={path(s.key)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {hover != null && (
              <g>
                <line x1={x(hover)} x2={x(hover)} y2={h} className="viz-crosshair" />
                {series.map((s) => (
                  <circle key={s.key} cx={x(hover)} cy={y(hv[s.key])} r={4.5} fill={s.color} className="viz-dot" />
                ))}
              </g>
            )}
            <rect width={w} height={h} fill="transparent" />
          </g>
        </svg>
      )}
      {hv && (
        <div className="viz-tip" style={{ left: tipLeft }} role="status">
          <div className="viz-tip-title">{formatX(hv[xKey], true)}</div>
          {series.map((s) => (
            <div key={s.key} className="viz-tip-row">
              <span className="viz-swatch" style={{ background: s.color }} aria-hidden="true" />{s.label}<b className="num">{hv[s.key]}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- Horizontal stacked bars (one row per entity) ---------------- */
export function StackedBars({ rows, segments, labelFor, summary }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null); // { row, seg, x, y }
  const rowH = 30;
  const gap = 14;
  const labelW = Math.min(150, Math.max(90, width * 0.28));
  const valueW = 40;
  const barW = Math.max(0, width - labelW - valueW);
  const total = (r) => segments.reduce((a, s) => a + r[s.key], 0);
  const max = Math.max(1, ...rows.map(total));
  const height = rows.length * (rowH + gap);

  return (
    <div ref={ref} className="viz-plot" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={summary} onPointerLeave={() => setHover(null)}>
          {rows.map((r, ri) => {
            const yTop = ri * (rowH + gap);
            let acc = 0;
            const drawn = segments.filter((s) => r[s.key] > 0);
            return (
              <g key={ri} transform={`translate(0,${yTop})`}>
                <text x={0} y={rowH / 2} dy="0.32em" className="viz-label">{labelFor(r)}</text>
                <rect x={labelW} width={barW} height={rowH} rx={6} className="viz-track" />
                {drawn.map((s, si) => {
                  const segW = (r[s.key] / max) * barW;
                  const xs = labelW + acc;
                  acc += segW;
                  const last = si === drawn.length - 1;
                  // 2px surface gap between adjacent fills; rounded 4px data-end only on the outer segment.
                  const wDraw = Math.max(1, segW - (last ? 0 : 2));
                  const d = last && wDraw > 8
                    ? `M${xs},0h${Math.max(0, wDraw - 4)}a4,4 0 0 1 4,4v${rowH - 8}a4,4 0 0 1 -4,4h${-Math.max(0, wDraw - 4)}z`
                    : `M${xs},0h${wDraw}v${rowH}h${-wDraw}z`;
                  const active = hover && hover.row === ri && hover.seg === s.key;
                  return (
                    <path key={s.key} d={d} fill={s.color} opacity={hover && !active ? 0.55 : 1}
                      onPointerEnter={() => setHover({ row: ri, seg: s.key, x: xs + segW / 2, y: yTop })} />
                  );
                })}
                <text x={labelW + (total(r) / max) * barW + 8} y={rowH / 2} dy="0.32em" className="viz-value num">{total(r)}</text>
              </g>
            );
          })}
        </svg>
      )}
      {hover && (
        <div className="viz-tip" style={{ left: Math.min(Math.max(hover.x, 90), width - 90), top: hover.y - 8, transform: 'translate(-50%, -100%)' }} role="status">
          <div className="viz-tip-title">{labelFor(rows[hover.row])}</div>
          {segments.map((s) => (
            <div key={s.key} className={`viz-tip-row ${s.key === hover.seg ? 'on' : ''}`}>
              <span className="viz-swatch" style={{ background: s.color }} aria-hidden="true" />{s.label}<b className="num">{rows[hover.row][s.key]}</b>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------------- Single-series vertical bars (ordered categories) ---------------- */
export function ColumnChart({ data, color, height = 220, summary }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const m = { top: 22, right: 8, bottom: 26, left: 8 };
  const w = Math.max(0, width - m.left - m.right);
  const h = height - m.top - m.bottom;
  const max = Math.max(1, ...data.map((d) => d.value));
  const band = w / Math.max(1, data.length);
  const barW = Math.min(56, band * 0.6);
  const bars = useMemo(() => data.map((d, i) => {
    const bh = (d.value / max) * h;
    const x = i * band + (band - barW) / 2;
    return { ...d, x, bh, y: h - bh };
  }), [data, max, h, band, barW]);

  return (
    <div ref={ref} className="viz-plot" style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={summary} onPointerLeave={() => setHover(null)}>
          <g transform={`translate(${m.left},${m.top})`}>
            <line x2={w} y1={h} y2={h} className="viz-axis" />
            {bars.map((b, i) => (
              <g key={b.label} onPointerEnter={() => setHover(i)}>
                <rect x={i * band} width={band} height={h} fill="transparent" />
                {b.value > 0 && (b.bh >= 4 ? (
                  <path d={`M${b.x},${h}v${-(b.bh - 4)}a4,4 0 0 1 4,-4h${barW - 8}a4,4 0 0 1 4,4v${b.bh - 4}z`}
                    fill={color} opacity={hover != null && hover !== i ? 0.55 : 1} />
                ) : <rect x={b.x} y={h - Math.max(2, b.bh)} width={barW} height={Math.max(2, b.bh)} fill={color} />)}
                <text x={b.x + barW / 2} y={b.y - 6} textAnchor="middle" className="viz-value num">{b.value}</text>
                <text x={b.x + barW / 2} y={h + 18} textAnchor="middle" className="viz-tick">{b.label}</text>
              </g>
            ))}
          </g>
        </svg>
      )}
    </div>
  );
}
