"use client";

import { useEffect, useMemo, useState } from "react";

type Run = {
  id: string;
  name: string;
  domain: string;
  status: "running" | "healthy" | "warning" | "failed";
  pages: string;
  coverage: number;
  spend: string;
  updated: string;
};

const seedRuns: Run[] = [
  { id: "run_4182", name: "Nordic catalog", domain: "nordicnest.com", status: "running", pages: "8,421 / 12k", coverage: 71, spend: "$14.28", updated: "Now" },
  { id: "run_4178", name: "Careers monitor", domain: "jobs.acme.io", status: "healthy", pages: "2,814", coverage: 100, spend: "$2.91", updated: "4 min ago" },
  { id: "run_4171", name: "Market pulse", domain: "retail-index.org", status: "warning", pages: "6,090", coverage: 82, spend: "$8.44", updated: "18 min ago" },
  { id: "run_4169", name: "Partner directory", domain: "ecosystem.dev", status: "healthy", pages: "1,288", coverage: 100, spend: "$1.73", updated: "42 min ago" },
];

const signals = [
  { tone: "amber", label: "Selector drift", detail: "price.current fell below 94%", project: "Nordic catalog", action: "Review 14 pages" },
  { tone: "red", label: "Block rate rising", detail: "18% of requests returned 403", project: "Market pulse", action: "Inspect defenses" },
  { tone: "blue", label: "New page pattern", detail: "312 uncategorized URLs detected", project: "Careers monitor", action: "Create rule" },
];

const activity = [
  { time: "12:38", text: "Adaptive parser recovered 184 price fields", meta: "Nordic catalog", tone: "lime" },
  { time: "12:34", text: "Retry budget capped before overrun", meta: "Market pulse · saved $6.20", tone: "amber" },
  { time: "12:29", text: "Robots policy refreshed", meta: "Careers monitor", tone: "slate" },
  { time: "12:17", text: "Export delivered to warehouse", meta: "Partner directory · 1,288 rows", tone: "blue" },
];

function StatusBadge({ status }: { status: Run["status"] }) {
  const copy = status === "running" ? "Live" : status[0].toUpperCase() + status.slice(1);
  return <span className={`status-badge status-${status}`}><i />{copy}</span>;
}

export function ScrapooDashboard() {
  const [runs, setRuns] = useState(seedRuns);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | Run["status"]>("all");
  const [modalOpen, setModalOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [activeNav, setActiveNav] = useState("Overview");
  const [apiState, setApiState] = useState<"demo" | "connected">("demo");

  useEffect(() => {
    const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL;
    if (!apiBase) return;
    const controller = new AbortController();
    fetch(`${apiBase}/api/dashboard/`, { signal: controller.signal })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((payload) => {
        if (Array.isArray(payload?.recent_runs) && payload.recent_runs.length) {
          setRuns(payload.recent_runs);
          setApiState("connected");
        }
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setModalOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [modalOpen]);

  const filteredRuns = useMemo(() => runs.filter((run) => {
    const matchesQuery = `${run.name} ${run.domain}`.toLowerCase().includes(query.toLowerCase());
    return matchesQuery && (filter === "all" || run.status === filter);
  }), [filter, query, runs]);

  const startCrawl = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const url = String(form.get("url") || "").replace(/^https?:\/\//, "").replace(/\/$/, "");
    const name = String(form.get("name") || "Untitled crawl");
    const newRun: Run = { id: `run_${Date.now()}`, name, domain: url, status: "running", pages: "0 / 5k", coverage: 2, spend: "$0.00", updated: "Now" };
    setRuns((current) => [newRun, ...current]);
    setModalOpen(false);
    setToast(`${name} is queued with a $12 spend cap.`);
    window.setTimeout(() => setToast(""), 4200);
  };

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <span>scrapoo</span>
        </div>

        <nav className="main-nav">
          <p>Workspace</p>
          {["Overview", "Crawlers", "Runs", "Data explorer"].map((item) => (
            <button className={activeNav === item ? "active" : ""} key={item} onClick={() => setActiveNav(item)}>
              <span className={`nav-icon icon-${item.toLowerCase().replace(" ", "-")}`} aria-hidden="true" />
              {item}
              {item === "Runs" && <em>3</em>}
            </button>
          ))}
          <p className="nav-section">Manage</p>
          {["Schedules", "Destinations", "Usage"].map((item) => (
            <button className={activeNav === item ? "active" : ""} key={item} onClick={() => setActiveNav(item)}>
              <span className={`nav-icon icon-${item.toLowerCase()}`} aria-hidden="true" />
              {item}
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="usage-card">
            <div><span>Monthly budget</span><strong>64%</strong></div>
            <div className="usage-track"><i /></div>
            <small>$126.40 of $200.00</small>
          </div>
          <button className="account-button" aria-label="Open account menu">
            <span className="avatar">AK</span>
            <span><b>Alex Kim</b><small>Team workspace</small></span>
            <i>···</i>
          </button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div className="mobile-brand">scrapoo</div>
          <label className="global-search">
            <span aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search crawlers, runs, or URLs" aria-label="Search workspace" />
            <kbd>⌘ K</kbd>
          </label>
          <div className="top-actions">
            <span className={`connection ${apiState}`}><i />{apiState === "connected" ? "API connected" : "Preview data"}</span>
            <button className="icon-button" aria-label="View notifications">°<span /></button>
            <button className="primary-button" onClick={() => setModalOpen(true)}><b>＋</b> New crawler</button>
          </div>
        </header>

        <div className="content-wrap">
          <div className="page-heading">
            <div>
              <span className="eyebrow">Operations / Overview</span>
              <h1>Crawl control</h1>
              <p>Know what changed, why it failed, and what every run costs.</p>
            </div>
            <div className="date-control"><span>Last 7 days</span><b>⌄</b></div>
          </div>

          <section className="metrics-grid" aria-label="Crawl summary">
            <article className="metric-card featured">
              <div className="metric-top"><span>Extraction health</span><i className="trend positive">↗ 1.8%</i></div>
              <div className="metric-value">99.1<span>%</span></div>
              <div className="mini-bars" aria-hidden="true">
                {[38, 46, 42, 61, 56, 68, 64, 77, 72, 86, 80, 94].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}
              </div>
              <small>Across 28 monitored fields</small>
            </article>
            <article className="metric-card">
              <div className="metric-top"><span>Pages collected</span><i className="metric-glyph">↗</i></div>
              <div className="metric-value">42,681</div>
              <div className="metric-footer"><i className="trend positive">+12.4%</i><small>vs previous period</small></div>
            </article>
            <article className="metric-card">
              <div className="metric-top"><span>Success rate</span><i className="metric-glyph">✓</i></div>
              <div className="metric-value">96.8<span>%</span></div>
              <div className="metric-footer"><i className="trend positive">+0.6%</i><small>1,413 retries recovered</small></div>
            </article>
            <article className="metric-card">
              <div className="metric-top"><span>Spend protected</span><i className="metric-glyph">⌁</i></div>
              <div className="metric-value">$38.20</div>
              <div className="metric-footer"><i className="trend amber">8 caps</i><small>stopped waste this week</small></div>
            </article>
          </section>

          <div className="dashboard-grid">
            <section className="panel runs-panel">
              <div className="panel-heading">
                <div><h2>Recent runs</h2><p>Live progress and quality signals</p></div>
                <div className="filter-tabs" aria-label="Filter runs">
                  {(["all", "running", "warning", "failed"] as const).map((value) => <button key={value} className={filter === value ? "active" : ""} onClick={() => setFilter(value)}>{value === "all" ? "All" : value}</button>)}
                </div>
              </div>
              <div className="run-table" role="table" aria-label="Recent crawl runs">
                <div className="run-row table-head" role="row">
                  <span>Run</span><span>Status</span><span>Coverage</span><span>Spend</span><span />
                </div>
                {filteredRuns.map((run) => (
                  <div className="run-row" role="row" key={run.id}>
                    <div className="run-name"><span className="site-avatar">{run.name.charAt(0)}</span><span><b>{run.name}</b><small>{run.domain} · {run.updated}</small></span></div>
                    <StatusBadge status={run.status} />
                    <div className="coverage"><span><b>{run.pages}</b><small>{run.coverage}%</small></span><div><i style={{ width: `${run.coverage}%` }} /></div></div>
                    <strong className="spend">{run.spend}</strong>
                    <button className="row-menu" aria-label={`Open ${run.name} run`}>›</button>
                  </div>
                ))}
                {!filteredRuns.length && <div className="empty-state">No runs match this filter.</div>}
              </div>
              <button className="panel-link">View all runs <span>→</span></button>
            </section>

            <section className="panel signals-panel">
              <div className="panel-heading">
                <div><h2>Needs attention</h2><p>Ranked by data risk</p></div>
                <span className="count-pill">3</span>
              </div>
              <div className="signal-list">
                {signals.map((signal) => (
                  <article key={signal.label}>
                    <span className={`signal-icon ${signal.tone}`}>!</span>
                    <div><div><b>{signal.label}</b><small>{signal.project}</small></div><p>{signal.detail}</p><button>{signal.action} <span>→</span></button></div>
                  </article>
                ))}
              </div>
            </section>

            <section className="panel activity-panel">
              <div className="panel-heading"><div><h2>Live activity</h2><p>Explanations, not mystery errors</p></div><span className="live-indicator"><i /> Live</span></div>
              <div className="activity-list">
                {activity.map((item) => <div key={item.time + item.text}><time>{item.time}</time><i className={item.tone} /><span><b>{item.text}</b><small>{item.meta}</small></span></div>)}
              </div>
            </section>

            <section className="panel quality-panel">
              <div className="panel-heading"><div><h2>Field reliability</h2><p>Schema coverage over 7 days</p></div><button className="quiet-button">Configure</button></div>
              <div className="quality-chart">
                <div className="chart-scale"><span>100%</span><span>75%</span><span>50%</span></div>
                <div className="chart-area">
                  <div className="threshold"><span>Alert threshold</span></div>
                  <div className="chart-columns" aria-label="Seven day field reliability chart">
                    {[94, 97, 93, 96, 86, 92, 99].map((value, index) => <div key={index}><i style={{ height: `${value}%` }} className={value < 90 ? "warning" : ""} /><small>{["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"][index]}</small></div>)}
                  </div>
                </div>
              </div>
              <div className="quality-legend"><span><i className="lime" /> Valid fields</span><span><i className="amber" /> Below threshold</span><strong>97.2% current</strong></div>
            </section>
          </div>
        </div>
      </section>

      {modalOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setModalOpen(false)}>
          <section className="crawl-modal" role="dialog" aria-modal="true" aria-labelledby="new-crawl-title">
            <button className="modal-close" onClick={() => setModalOpen(false)} aria-label="Close dialog">×</button>
            <span className="modal-kicker">New crawler</span>
            <h2 id="new-crawl-title">Start with a safe budget.</h2>
            <p>Scrapoo will inspect the site policy, classify page patterns, and pause before costs exceed your limit.</p>
            <form onSubmit={startCrawl}>
              <label>Project name<input name="name" placeholder="e.g. Competitor catalog" required autoFocus /></label>
              <label>Starting URL<input name="url" type="url" placeholder="https://example.com/products" required /></label>
              <div className="form-row"><label>Page limit<select name="page_limit" defaultValue="5000"><option value="500">500 pages</option><option value="5000">5,000 pages</option><option value="25000">25,000 pages</option></select></label><label>Spend cap<select name="spend_cap" defaultValue="12"><option value="5">$5.00</option><option value="12">$12.00</option><option value="50">$50.00</option></select></label></div>
              <label className="check-row"><input type="checkbox" defaultChecked /><span><b>Respect robots.txt</b><small>Recommended for responsible crawling</small></span></label>
              <div className="modal-actions"><button type="button" onClick={() => setModalOpen(false)}>Cancel</button><button className="primary-button" type="submit">Inspect & queue <span>→</span></button></div>
            </form>
          </section>
        </div>
      )}

      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}
