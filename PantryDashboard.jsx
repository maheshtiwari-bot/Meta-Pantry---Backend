import { useState } from "react";

/* ============================================================
   Meta India — Pantry Inventory (React frontend)
   ------------------------------------------------------------
   BEGINNER NOTES:
   • Everything lives in this one file so it's easy to read.
   • Data is kept in React "state" (useState). In the real app,
     you would fetch this from the Node.js backend instead —
     look for the comments marked  // API: ...
   ============================================================ */

// ---------- Color palette (matches the screenshots) ----------
const C = {
  bg: "#f3f1e7",       // cream page background
  bar: "#eceadd",      // header strip
  card: "#ffffff",     // white cards
  panel: "#f7f5ec",    // inner beige panels
  border: "#e3e0d2",
  ink: "#21201b",
  sub: "#6e6c5f",
  green: "#3c7a2c",
  greenBg: "#e6efdb",
  amber: "#b07408",
  amberBg: "#f5ecd2",
  red: "#b3271e",
  redBg: "#f7ddda",
  blue: "#1f5fa8",
  blueBg: "#e4eef9",
};

// ---------- Helper: status from "days left" ----------
function statusFor(days) {
  if (days < 2) return "Critical";
  if (days < 4) return "Low";
  return "Healthy";
}

const statusStyles = {
  Critical: { color: C.red, background: C.redBg },
  Low: { color: C.amber, background: C.amberBg },
  Healthy: { color: C.green, background: C.greenBg },
};

function Pill({ label }) {
  const s = statusStyles[label] || { color: C.sub, background: C.panel };
  return (
    <span
      style={{ ...s, fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 999 }}
    >
      {label}
    </span>
  );
}

function Tag({ label }) {
  return (
    <span
      style={{
        background: C.panel,
        border: `1px solid ${C.border}`,
        color: C.sub,
        fontSize: 12,
        padding: "3px 10px",
        borderRadius: 999,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

// Small horizontal stock-level bar
function StockBar({ days }) {
  const pct = Math.max(6, Math.min(100, (days / 8) * 100));
  const color =
    statusFor(days) === "Critical" ? C.red : statusFor(days) === "Low" ? "#d99a14" : "#6a9a3a";
  return (
    <div style={{ width: 90, height: 6, background: "#eceadf", borderRadius: 999 }}>
      <div style={{ width: `${pct}%`, height: 6, background: color, borderRadius: 999 }} />
    </div>
  );
}

const inputStyle = {
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  padding: "10px 14px",
  fontSize: 15,
  width: "100%",
  background: "#fff",
  color: C.ink,
  boxSizing: "border-box",
};

const btn = (primary) => ({
  border: `1px solid ${primary ? C.ink : C.border}`,
  background: "#fff",
  color: C.ink,
  borderRadius: 12,
  padding: "10px 18px",
  fontSize: 15,
  fontWeight: 600,
  cursor: "pointer",
});

const th = {
  textAlign: "left",
  fontSize: 11.5,
  letterSpacing: "0.06em",
  color: C.sub,
  fontWeight: 600,
  padding: "8px 12px",
  textTransform: "uppercase",
  borderBottom: `1px solid ${C.border}`,
};
const td = { padding: "14px 12px", fontSize: 15, color: C.ink, borderBottom: `1px solid ${C.border}` };

// ============================================================
//                       INITIAL DATA
//  (In the full app this comes from the Node.js API)
// ============================================================
const initialCategories = [
  { name: "Cold Coffee", skus: 4, days: 1.2 },
  { name: "Protein Shakes", skus: 2, days: 0.8 },
  { name: "Greek Yogurt", skus: 3, days: 2.1 },
  { name: "Kombucha", skus: 2, days: 2.8 },
  { name: "Aerated Beverages", skus: 5, days: 5.4 },
  { name: "Biscuits", skus: 3, days: 6.0 },
  { name: "Herbal Tea", skus: 4, days: 7.2 },
];

const kitchens = [
  { name: "Floor 3 — Main Pantry", supervisor: "Ravi Kumar", skus: 22, low: 2, updated: "Today" },
  { name: "Floor 6 — Mini Kitchen", supervisor: "Priya Nair", skus: 14, low: 1, updated: "Yesterday" },
  { name: "Floor 9 — Café Corner", supervisor: "Ankit Sharma", skus: 11, low: 0, updated: "Today" },
];

const initialGrn = [
  { product: "Sleepy Owl Cold Brew Black", category: "Cold Coffee", qty: 48 },
  { product: "Epigamia Greek Yogurt – Mango", category: "Greek Yogurt", qty: 34 },
  { product: "Tetley Green Tea Immune", category: "Herbal Tea", qty: 24 },
  { product: "Nectaras Kombucha Ginger", category: "Kombucha", qty: 60 },
  { product: "Britannia Good Day Cookies", category: "Biscuits", qty: 72 },
];

const initialStock = [
  { product: "Sleepy Owl Cold Brew", category: "Cold Coffee", min: "10 units", count: 8, rate: 6 },
  { product: "Epigamia Greek Yogurt", category: "Greek Yogurt", min: "8 units", count: 14, rate: 5 },
  { product: "Nectaras Kombucha", category: "Kombucha", min: "12 units", count: 22, rate: 8 },
  { product: "Tetley Green Tea", category: "Herbal Tea", min: "6 boxes", count: 18, rate: 2 },
  { product: "Britannia Good Day", category: "Biscuits", min: "10 packs", count: 42, rate: 6 },
];

const initialDist = [
  { product: "Sleepy Owl Cold Brew", available: 48, floors: [20, 16, 12] },
  { product: "Epigamia Yogurt – Mango", available: 34, floors: [14, 12, 8] },
  { product: "Nectaras Kombucha", available: 60, floors: [24, 20, 16] },
];

const initialLocations = [
  { name: "Floor 3 — Main Pantry", supervisor: "Ravi Kumar", contact: "+91 98400 00001", minDays: 3, freq: "Every 2 days", capacity: 500 },
  { name: "Floor 6 — Mini Kitchen", supervisor: "Priya Nair", contact: "+91 98400 00002", minDays: 2, freq: "Weekly", capacity: 250 },
  { name: "Floor 9 — Café Corner", supervisor: "Ankit Sharma", contact: "+91 98400 00003", minDays: 2, freq: "Weekly", capacity: 200 },
];

// ============================================================
//                          SCREENS
// ============================================================

function Dashboard({ categories }) {
  const lowCount = categories.filter((c) => statusFor(c.days) !== "Healthy").length;
  const stats = [
    { value: "₹2.4L", label: "Total stock value (this month)", color: C.blue },
    { value: "18", label: "Days of stock overall", color: C.blue },
    { value: String(lowCount + 2), label: "Categories low", color: C.amber },
    { value: "38", label: "Categories healthy", color: C.green },
  ];
  return (
    <>
      {/* Stat cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14, marginBottom: 18 }}>
        {stats.map((s) => (
          <div key={s.label} style={{ background: C.panel, borderRadius: 14, padding: "18px 20px" }}>
            <div style={{ fontSize: 26, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 13, color: C.sub, marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Category health table */}
      <div style={{ background: C.card, borderRadius: 16, padding: 22, marginBottom: 18, border: `1px solid ${C.border}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <div style={{ fontSize: 12.5, letterSpacing: "0.08em", fontWeight: 700, color: C.ink }}>
            CATEGORY HEALTH — ALL SITES
          </div>
          <button style={btn(false)}>View all</button>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Category</th>
                <th style={th}>SKUs</th>
                <th style={th}>Stock level</th>
                <th style={th}>Days remaining</th>
                <th style={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => {
                const st = statusFor(c.days);
                const dayColor = st === "Critical" ? C.red : st === "Low" ? C.amber : C.ink;
                return (
                  <tr key={c.name}>
                    <td style={td}>{c.name}</td>
                    <td style={td}>{c.skus}</td>
                    <td style={td}><StockBar days={c.days} /></td>
                    <td style={{ ...td, color: dayColor, fontWeight: st === "Healthy" ? 400 : 700 }}>
                      {c.days.toFixed(1)} days
                    </td>
                    <td style={td}><Pill label={st} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mini-kitchen snapshot */}
      <div style={{ background: C.card, borderRadius: 16, padding: 22, border: `1px solid ${C.border}` }}>
        <div style={{ fontSize: 12.5, letterSpacing: "0.08em", fontWeight: 700, marginBottom: 14 }}>
          MINI-KITCHEN SNAPSHOT
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
          {kitchens.map((k) => (
            <div key={k.name} style={{ background: C.panel, borderRadius: 12, padding: 16 }}>
              <div style={{ fontWeight: 700, marginBottom: 10 }}>🏢 {k.name}</div>
              {[
                ["Supervisor", k.supervisor, C.ink],
                ["SKUs tracked", k.skus, C.ink],
                ["Categories low", k.low, k.low > 0 ? C.red : C.green],
                ["Last stock update", k.updated, C.ink],
              ].map(([l, v, col]) => (
                <div key={l} style={{ display: "flex", justifyContent: "space-between", fontSize: 13.5, padding: "3px 0" }}>
                  <span style={{ color: C.sub }}>{l}</span>
                  <span style={{ color: col, fontWeight: 600 }}>{v}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function ReceiveGrn({ rows, setRows, onAcknowledge, acknowledged }) {
  return (
    <div style={{ background: C.card, borderRadius: 16, padding: 22, border: `1px solid ${C.border}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 12.5, letterSpacing: "0.08em", fontWeight: 700 }}>
            INBOUND DELIVERY — ACKNOWLEDGE GRN
          </div>
          <div style={{ fontSize: 13.5, color: C.sub, marginTop: 4 }}>
            Dispatch #SDX-2406-0047 · From Bengaluru DC · Expected today
          </div>
        </div>
        <span style={{ background: acknowledged ? C.greenBg : C.blueBg, color: acknowledged ? C.green : C.blue, fontSize: 12.5, fontWeight: 600, padding: "5px 12px", borderRadius: 999, height: "fit-content" }}>
          {acknowledged ? "✓ Received" : "🚚 In transit"}
        </span>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={th}>Product</th>
            <th style={th}>Category</th>
            <th style={th}>Qty received</th>
            <th style={th}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.product}>
              <td style={{ ...td, maxWidth: 200 }}>{r.product}</td>
              <td style={td}><Tag label={r.category} /></td>
              <td style={td}>
                <input
                  type="number"
                  value={r.qty}
                  disabled={acknowledged}
                  onChange={(e) => {
                    const copy = [...rows];
                    copy[i] = { ...r, qty: Number(e.target.value) };
                    setRows(copy); // API: PATCH /api/grn/items/:id
                  }}
                  style={{ ...inputStyle, width: 130, textAlign: "center" }}
                />
              </td>
              <td style={td}><Pill label="Healthy" /></td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 12, marginTop: 18 }}>
        <button style={btn(false)} disabled={acknowledged}>Save draft</button>
        <button style={btn(true)} disabled={acknowledged} onClick={onAcknowledge}>
          {acknowledged ? "Stock updated ✓" : "Acknowledge & update stock"}
        </button>
      </div>
    </div>
  );
}

function Distribute({ rows, setRows, onConfirm, confirmed }) {
  const floors = ["Floor 3", "Floor 6", "Floor 9"];
  return (
    <div style={{ background: C.card, borderRadius: 16, padding: 22, border: `1px solid ${C.border}` }}>
      <div style={{ fontSize: 12.5, letterSpacing: "0.08em", fontWeight: 700 }}>
        DISTRIBUTE FROM MAIN RECEIVING TO MINI-KITCHENS
      </div>
      <div style={{ fontSize: 13.5, color: C.sub, margin: "6px 0 12px" }}>
        Allocate stock from today's GRN to individual floors
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Product</th>
              <th style={th}>Available</th>
              {floors.map((f) => <th key={f} style={th}>{f}</th>)}
              <th style={th}>Unallocated</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const remaining = r.available - r.floors.reduce((a, b) => a + b, 0);
              return (
                <tr key={r.product}>
                  <td style={{ ...td, maxWidth: 160 }}>{r.product}</td>
                  <td style={td}>{r.available}</td>
                  {r.floors.map((v, fi) => (
                    <td key={fi} style={td}>
                      <input
                        type="number"
                        value={v}
                        disabled={confirmed}
                        onChange={(e) => {
                          const copy = rows.map((row) => ({ ...row, floors: [...row.floors] }));
                          copy[i].floors[fi] = Number(e.target.value);
                          setRows(copy);
                        }}
                        style={{ ...inputStyle, width: 90, textAlign: "center" }}
                      />
                    </td>
                  ))}
                  <td style={{ ...td, fontWeight: 700, color: remaining === 0 ? C.green : remaining < 0 ? C.red : C.amber }}>
                    {remaining}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 18 }}>
        <button style={btn(true)} disabled={confirmed} onClick={onConfirm}>
          {confirmed ? "Distribution confirmed ✓" : "Confirm distribution"}
        </button>
      </div>
    </div>
  );
}

function StockUpdate({ rows, setRows }) {
  const [submitted, setSubmitted] = useState(false);
  return (
    <div style={{ background: C.card, borderRadius: 16, padding: 22, border: `1px solid ${C.border}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 12.5, letterSpacing: "0.08em", fontWeight: 700 }}>STOCK COUNT UPDATE</div>
          <div style={{ fontSize: 13.5, color: C.sub, marginTop: 4 }}>
            Enter current physical count. System calculates days of stock remaining.
          </div>
        </div>
        <select style={{ ...inputStyle, width: 230 }}>
          <option>Floor 3 — Main Pantry</option>
          <option>Floor 6 — Mini Kitchen</option>
          <option>Floor 9 — Café Corner</option>
        </select>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={th}>Product</th>
              <th style={th}>Category</th>
              <th style={th}>Min threshold</th>
              <th style={th}>Physical count</th>
              <th style={th}>Daily consumption</th>
              <th style={th}>Days left</th>
              <th style={th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const days = r.rate > 0 ? r.count / r.rate : 0; // ← live calculation
              const st = statusFor(days);
              const dayColor = st === "Critical" ? C.red : st === "Low" ? C.amber : C.ink;
              return (
                <tr key={r.product}>
                  <td style={{ ...td, maxWidth: 130 }}>{r.product}</td>
                  <td style={td}><Tag label={r.category} /></td>
                  <td style={td}>{r.min}</td>
                  <td style={td}>
                    <input
                      type="number"
                      value={r.count}
                      onChange={(e) => {
                        const copy = [...rows];
                        copy[i] = { ...r, count: Number(e.target.value) };
                        setRows(copy); // API: POST /api/stock
                      }}
                      style={{ ...inputStyle, width: 100, textAlign: "center" }}
                    />
                  </td>
                  <td style={td}>{r.rate}/day</td>
                  <td style={{ ...td, color: dayColor, fontWeight: st === "Healthy" ? 400 : 700 }}>{days.toFixed(1)}</td>
                  <td style={td}><Pill label={st} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginTop: 18 }}>
        <button
          style={{ ...btn(false), borderStyle: "dashed" }}
          onClick={() =>
            setRows([...rows, { product: "New product", category: "Biscuits", min: "10 units", count: 0, rate: 1 }])
          }
        >
          + Add product
        </button>
        <div style={{ display: "flex", gap: 12 }}>
          <button style={btn(false)}>Save draft</button>
          <button style={btn(true)} onClick={() => setSubmitted(true)}>
            {submitted ? "Submitted ✓" : "Submit stock count"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Settings({ locations, setLocations }) {
  const update = (i, field, value) => {
    const copy = [...locations];
    copy[i] = { ...copy[i], [field]: value };
    setLocations(copy); // API: PUT /api/locations/:id
  };
  const field = (label, value, onChange, type = "text") => (
    <div style={{ flex: "1 1 160px" }}>
      <div style={{ fontSize: 12.5, color: C.sub, marginBottom: 6 }}>{label}</div>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle} />
    </div>
  );
  return (
    <div style={{ background: C.card, borderRadius: 16, padding: 22, border: `1px solid ${C.border}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
        <div style={{ fontSize: 12.5, letterSpacing: "0.08em", fontWeight: 700 }}>MINI-KITCHEN LOCATIONS</div>
        <button
          style={btn(false)}
          onClick={() =>
            setLocations([
              ...locations,
              { name: "New location", supervisor: "", contact: "+91 ", minDays: 2, freq: "Weekly", capacity: 100 },
            ])
          }
        >
          + Add location
        </button>
      </div>

      {locations.map((loc, i) => (
        <div key={i} style={{ background: C.panel, borderRadius: 14, padding: 18, marginBottom: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
            <div style={{ fontWeight: 700 }}>🏢 {loc.name}</div>
            <button
              title="Delete location"
              style={{ border: `1px solid ${C.redBg}`, background: "#fff", color: C.red, borderRadius: 10, padding: "6px 10px", cursor: "pointer" }}
              onClick={() => setLocations(locations.filter((_, j) => j !== i))}
            >
              🗑
            </button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginBottom: 12 }}>
            {field("Location name", loc.name, (v) => update(i, "name", v))}
            {field("Supervisor name", loc.supervisor, (v) => update(i, "supervisor", v))}
            {field("Supervisor contact", loc.contact, (v) => update(i, "contact", v))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
            {field("Min stock to maintain (days)", loc.minDays, (v) => update(i, "minDays", v), "number")}
            <div style={{ flex: "1 1 160px" }}>
              <div style={{ fontSize: 12.5, color: C.sub, marginBottom: 6 }}>Stock count frequency</div>
              <select value={loc.freq} onChange={(e) => update(i, "freq", e.target.value)} style={inputStyle}>
                <option>Daily</option>
                <option>Every 2 days</option>
                <option>Weekly</option>
              </select>
            </div>
            {field("Storage capacity (approx. units)", loc.capacity, (v) => update(i, "capacity", v), "number")}
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
//                       MAIN APP SHELL
// ============================================================
export default function PantryDashboard() {
  const tabs = ["Dashboard", "Receive GRN", "Distribute", "Stock Update", "Settings"];
  const [tab, setTab] = useState("Dashboard");

  const [categories, setCategories] = useState(initialCategories);
  const [grnRows, setGrnRows] = useState(initialGrn);
  const [stockRows, setStockRows] = useState(initialStock);
  const [distRows, setDistRows] = useState(initialDist);
  const [locations, setLocations] = useState(initialLocations);
  const [acknowledged, setAcknowledged] = useState(false);
  const [distConfirmed, setDistConfirmed] = useState(false);
  const [toast, setToast] = useState("");

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  // When GRN is acknowledged, add received qty into matching stock + category days
  const acknowledgeGrn = () => {
    // API: POST /api/grn/acknowledge
    setStockRows((rows) =>
      rows.map((r) => {
        const match = grnRows.find((g) => g.category === r.category);
        return match ? { ...r, count: r.count + match.qty } : r;
      })
    );
    setCategories((cats) =>
      cats.map((c) => {
        const match = grnRows.find((g) => g.category === c.name);
        return match ? { ...c, days: +(c.days + match.qty / 20).toFixed(1) } : c;
      })
    );
    setAcknowledged(true);
    showToast("GRN acknowledged — stock levels updated across the dashboard");
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, fontFamily: "'Segoe UI', system-ui, sans-serif", color: C.ink }}>
      {/* ---------- Header ---------- */}
      <div style={{ background: C.bar, borderBottom: `1px solid ${C.border}`, padding: "16px 22px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", maxWidth: 980, margin: "0 auto" }}>
          <div>
            <div style={{ fontSize: 19, fontWeight: 700 }}>🏢 Meta India — Pantry Inventory</div>
            <div style={{ fontSize: 13, color: C.sub, marginTop: 2 }}>
              Managed by Sodexo · Last updated: Today, 9:42 AM
            </div>
          </div>
          <span style={{ background: C.greenBg, color: C.green, fontSize: 12.5, fontWeight: 600, padding: "5px 12px", borderRadius: 999 }}>
            📶 Live
          </span>
        </div>
      </div>

      {/* ---------- Tab navigation ---------- */}
      <div style={{ background: C.bar, borderBottom: `1px solid ${C.border}`, padding: "0 22px 14px" }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", maxWidth: 980, margin: "0 auto" }}>
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                ...btn(false),
                background: tab === t ? "#fff" : "transparent",
                border: `1px solid ${tab === t ? C.ink : C.border}`,
                fontWeight: tab === t ? 700 : 500,
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* ---------- Active screen ---------- */}
      <div style={{ maxWidth: 980, margin: "0 auto", padding: 22 }}>
        {tab === "Dashboard" && <Dashboard categories={categories} />}
        {tab === "Receive GRN" && (
          <ReceiveGrn rows={grnRows} setRows={setGrnRows} onAcknowledge={acknowledgeGrn} acknowledged={acknowledged} />
        )}
        {tab === "Distribute" && (
          <Distribute
            rows={distRows}
            setRows={setDistRows}
            confirmed={distConfirmed}
            onConfirm={() => {
              setDistConfirmed(true); // API: POST /api/distribute
              showToast("Stock distributed to Floors 3, 6 and 9");
            }}
          />
        )}
        {tab === "Stock Update" && <StockUpdate rows={stockRows} setRows={setStockRows} />}
        {tab === "Settings" && <Settings locations={locations} setLocations={setLocations} />}
      </div>

      {/* ---------- Toast notification ---------- */}
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#1c1c18",
            color: "#fff",
            padding: "12px 22px",
            borderRadius: 999,
            fontSize: 14,
            fontWeight: 600,
            boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
