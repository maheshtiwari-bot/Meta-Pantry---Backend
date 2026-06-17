const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// ─────────────────────────── Database ───────────────────────────
const db = {
  sites: [],        // { id, name, preferredDays }
  products: [],     // { id, code, name, brand, category, subCategory, mrp, caseSize, uom, hsnCode, gst, weight, status }
  vendors: [],      // { id, name, products: "all" | [code,...] }
  statusDefs: { critical: { from: 0, to: 2 }, healthy: { from: 2, to: 7 }, excessive: { from: 7, to: 9999 } },
  users: [{ id: 1, loginId: "admin", password: "admin123", role: "admin", name: "Admin" }],
  stockUpdate: [],  // { id, siteId, productCode, qty, preferredDaysOverride, updatedAt, updatedBy }
  stockHistory: [], // { id, siteId, productCode, qty, updatedAt, updatedBy }
  stockInwards: [], // { id, dcCode, from, to, vendor, items:[{hsnCode,productCode,productName,mrp,gst,qty}], date }
  productPerformance: [], // { productCode, siteId, qtyPerDay, method:'manual'|'auto', updatedAt }
  orders: [],       // { id, siteId, placedBy, items:[{productCode,productName,brand,qty,mrp}], status, createdAt, feedback }
};

// ─────────────────────────── Helpers ───────────────────────────
const statusFor = (days, defs) => {
  const d = defs || db.statusDefs;
  if (days === null || days === undefined) return "Unknown";
  if (days <= d.critical.to) return "Critical";
  if (days >= d.excessive.from) return "Excessive";
  return "Healthy";
};

const getAvailDays = (productCode, siteId) => {
  const su = db.stockUpdate.find(s => s.siteId === siteId && s.productCode === productCode);
  const pp = db.productPerformance.find(p => p.productCode === productCode && p.siteId === siteId);
  if (!su || !pp || !pp.qtyPerDay) return null;
  return +(su.qty / pp.qtyPerDay).toFixed(2);
};

const getSitePreferredDays = (siteId, productCode) => {
  const su = db.stockUpdate.find(s => s.siteId === siteId && s.productCode === productCode);
  if (su && su.preferredDaysOverride != null) return su.preferredDaysOverride;
  const site = db.sites.find(s => s.id === siteId);
  return site ? (site.preferredDays || 5) : 5;
};

let orderSeq = 1;
const nextOrderId = () => `ORD-${String(orderSeq++).padStart(5, "0")}`;

// ─────────────────────────── Auth ───────────────────────────
app.post("/api/auth/login", (req, res) => {
  const { loginId, password } = req.body || {};
  const user = db.users.find(u => u.loginId === loginId && u.password === password);
  if (!user) return res.status(401).json({ error: "Invalid login ID or password" });
  res.json({ id: user.id, loginId: user.loginId, name: user.name, role: user.role });
});

// ─────────────────────────── Dashboard ───────────────────────────
app.get("/api/dashboard", (req, res) => {
  const siteIds = req.query.siteIds
    ? req.query.siteIds.split(",").map(Number)
    : db.sites.map(s => s.id);

  const rows = [];
  siteIds.forEach(siteId => {
    const site = db.sites.find(s => s.id === siteId);
    if (!site) return;
    db.stockUpdate
      .filter(su => su.siteId === siteId)
      .forEach(su => {
        const prod = db.products.find(p => p.code === su.productCode);
        if (!prod) return;
        const days = getAvailDays(su.productCode, siteId);
        rows.push({
          siteId, siteName: site.name,
          productCode: prod.code, productName: prod.name, brand: prod.brand,
          category: prod.category, subCategory: prod.subCategory, mrp: prod.mrp,
          availableQty: su.qty,
          preferredDays: getSitePreferredDays(siteId, su.productCode),
          availableDays: days,
          status: statusFor(days, db.statusDefs),
        });
      });
  });

  const totalStockValue = rows.reduce((s, r) => s + r.availableQty * r.mrp, 0);
  const withDays = rows.filter(r => r.availableDays !== null);
  const avgDays = withDays.length ? +(withDays.reduce((s, r) => s + r.availableDays, 0) / withDays.length).toFixed(1) : 0;

  res.json({
    totalStockValue: +totalStockValue.toFixed(2),
    avgDaysOfStock: avgDays,
    criticalCount: rows.filter(r => r.status === "Critical").length,
    healthyCount: rows.filter(r => r.status === "Healthy").length,
    excessiveCount: rows.filter(r => r.status === "Excessive").length,
    rows,
  });
});

// ─────────────────────────── Products ───────────────────────────
app.get("/api/products", (req, res) => res.json(db.products));

app.post("/api/products", (req, res) => {
  const p = req.body;
  if (db.products.find(x => x.code === p.code))
    return res.status(400).json({ error: `Product Code "${p.code}" already exists` });
  if (db.products.find(x => x.name.toLowerCase() === (p.name || "").toLowerCase()))
    return res.status(400).json({ error: `Product Name "${p.name}" already exists` });
  const product = { id: Date.now(), ...p };
  db.products.push(product);
  res.status(201).json(product);
});

app.put("/api/products/:code", (req, res) => {
  const prod = db.products.find(p => p.code === req.params.code);
  if (!prod) return res.status(404).json({ error: "Product not found" });
  const duplicate = db.products.find(p => p.name.toLowerCase() === (req.body.name || "").toLowerCase() && p.code !== req.params.code);
  if (duplicate) return res.status(400).json({ error: `Product Name "${req.body.name}" already exists` });
  Object.assign(prod, req.body, { code: prod.code });
  res.json(prod);
});

app.delete("/api/products/:code", (req, res) => {
  db.products = db.products.filter(p => p.code !== req.params.code);
  res.json({ message: "Deleted" });
});

// Legacy taxonomy endpoint — returns products in old format for backward compat
app.get("/api/products/taxonomy", (req, res) =>
  res.json(db.products.map(p => ({ code: p.code, sku: p.name, category: p.category, subCategory: p.subCategory, mrp: p.mrp, caseSize: p.caseSize })))
);

// ─────────────────────────── Sites ───────────────────────────
app.get("/api/sites", (req, res) => res.json(db.sites));

app.post("/api/sites", (req, res) => {
  if (db.sites.find(s => s.name.toLowerCase() === (req.body.name || "").toLowerCase()))
    return res.status(400).json({ error: "Site name already exists" });
  const site = { id: Date.now(), preferredDays: 5, ...req.body };
  db.sites.push(site);
  res.status(201).json(site);
});

app.put("/api/sites/:id", (req, res) => {
  const site = db.sites.find(s => s.id === Number(req.params.id));
  if (!site) return res.status(404).json({ error: "Site not found" });
  Object.assign(site, req.body, { id: site.id });
  res.json(site);
});

app.delete("/api/sites/:id", (req, res) => {
  db.sites = db.sites.filter(s => s.id !== Number(req.params.id));
  res.json({ message: "Deleted" });
});

// ─────────────────────────── Vendors ───────────────────────────
app.get("/api/vendors", (req, res) => res.json(db.vendors));

app.post("/api/vendors", (req, res) => {
  const vendor = { id: Date.now(), products: "all", ...req.body };
  db.vendors.push(vendor);
  res.status(201).json(vendor);
});

app.put("/api/vendors/:id", (req, res) => {
  const v = db.vendors.find(v => v.id === Number(req.params.id));
  if (!v) return res.status(404).json({ error: "Vendor not found" });
  Object.assign(v, req.body, { id: v.id });
  res.json(v);
});

app.delete("/api/vendors/:id", (req, res) => {
  db.vendors = db.vendors.filter(v => v.id !== Number(req.params.id));
  res.json({ message: "Deleted" });
});

// ─────────────────────────── Status Definitions ───────────────────────────
app.get("/api/status-defs", (req, res) => res.json(db.statusDefs));

app.put("/api/status-defs", (req, res) => {
  Object.assign(db.statusDefs, req.body);
  res.json(db.statusDefs);
});

// ─────────────────────────── Users ───────────────────────────
app.get("/api/users", (req, res) => res.json(db.users.map(u => ({ ...u, password: undefined }))));

app.post("/api/users", (req, res) => {
  if (db.users.find(u => u.loginId === req.body.loginId))
    return res.status(400).json({ error: "Login ID already exists" });
  const user = { id: Date.now(), ...req.body };
  db.users.push(user);
  res.status(201).json({ ...user, password: undefined });
});

app.put("/api/users/:id", (req, res) => {
  const user = db.users.find(u => u.id === Number(req.params.id));
  if (!user) return res.status(404).json({ error: "User not found" });
  const dup = db.users.find(u => u.loginId === req.body.loginId && u.id !== user.id);
  if (dup) return res.status(400).json({ error: "Login ID already taken" });
  Object.assign(user, req.body, { id: user.id });
  res.json({ ...user, password: undefined });
});

app.delete("/api/users/:id", (req, res) => {
  db.users = db.users.filter(u => u.id !== Number(req.params.id));
  res.json({ message: "Deleted" });
});

// ─────────────────────────── Stock Update ───────────────────────────
app.get("/api/stock-update", (req, res) => {
  const siteId = Number(req.query.siteId);
  const rows = db.stockUpdate
    .filter(s => s.siteId === siteId)
    .map(s => {
      const prod = db.products.find(p => p.code === s.productCode) || {};
      return {
        ...s,
        productName: prod.name || s.productCode,
        brand: prod.brand || "",
        category: prod.category || "",
        subCategory: prod.subCategory || "",
        mrp: prod.mrp || 0,
        caseSize: prod.caseSize || 1,
        hsnCode: prod.hsnCode || "",
        uom: prod.uom || "",
        preferredDays: getSitePreferredDays(siteId, s.productCode),
      };
    });
  res.json(rows);
});

app.post("/api/stock-update", (req, res) => {
  const { siteId, productCode, qty, preferredDaysOverride, updatedBy } = req.body;
  let row = db.stockUpdate.find(s => s.siteId === Number(siteId) && s.productCode === productCode);
  if (!row) {
    row = { id: Date.now(), siteId: Number(siteId), productCode, qty: 0 };
    db.stockUpdate.push(row);
  }
  const prevQty = row.qty;
  row.qty = Number(qty);
  if (preferredDaysOverride != null) row.preferredDaysOverride = Number(preferredDaysOverride);
  row.updatedAt = new Date().toISOString();
  row.updatedBy = updatedBy || "System";

  db.stockHistory.unshift({ id: Date.now(), siteId: Number(siteId), productCode, prevQty, qty: row.qty, updatedAt: row.updatedAt, updatedBy: row.updatedBy });
  res.json(row);
});

app.get("/api/stock-update/history", (req, res) => {
  const siteId = Number(req.query.siteId);
  const hist = db.stockHistory
    .filter(h => h.siteId === siteId)
    .map(h => {
      const prod = db.products.find(p => p.code === h.productCode) || {};
      return { ...h, productName: prod.name || h.productCode };
    });
  res.json(hist);
});

// ─────────────────────────── Stock Inward ───────────────────────────
app.get("/api/stock-inward/history", (req, res) => {
  const siteId = req.query.siteId ? Number(req.query.siteId) : null;
  const list = siteId ? db.stockInwards.filter(s => s.to === siteId) : db.stockInwards;
  res.json(list);
});

// Legacy per-site history
app.get("/api/sites/:siteId/stock-inward/history", (req, res) => {
  res.json(db.stockInwards.filter(s => s.to === Number(req.params.siteId)));
});

app.post("/api/stock-inward", (req, res) => {
  const { dcCode, from, to, vendor, items } = req.body;
  const record = {
    id: Date.now(),
    dcCode,
    from: Number(from),
    to: Number(to),
    vendor: Number(vendor),
    items: Array.isArray(items) ? items : [],
    date: new Date().toISOString(),
    status: "Confirmed",
  };
  db.stockInwards.unshift(record);

  // Add quantities to stock update for the destination site
  record.items.forEach(it => {
    const qty = Number(it.qty) || 0;
    if (!qty || !it.productCode) return;
    let row = db.stockUpdate.find(s => s.siteId === Number(to) && s.productCode === it.productCode);
    if (!row) {
      row = { id: Date.now(), siteId: Number(to), productCode: it.productCode, qty: 0, updatedAt: null, updatedBy: null };
      db.stockUpdate.push(row);
    }
    row.qty += qty;
    row.updatedAt = new Date().toISOString();
    row.updatedBy = "Stock Inward";
  });

  res.status(201).json(record);
});

// ─────────────────────────── Product Performance ───────────────────────────
app.get("/api/product-performance", (req, res) => {
  const siteId = Number(req.query.siteId);
  const rows = db.stockUpdate
    .filter(su => su.siteId === siteId)
    .map(su => {
      const prod = db.products.find(p => p.code === su.productCode) || {};
      const perf = db.productPerformance.find(p => p.productCode === su.productCode && p.siteId === siteId) || {};
      return {
        productCode: su.productCode,
        productName: prod.name || su.productCode,
        brand: prod.brand || "",
        category: prod.category || "",
        subCategory: prod.subCategory || "",
        mrp: prod.mrp || 0,
        qtyPerDay: perf.qtyPerDay || null,
        method: perf.method || null,
        updatedAt: perf.updatedAt || null,
      };
    });
  res.json(rows);
});

app.post("/api/product-performance", (req, res) => {
  const { productCode, siteId, qtyPerDay, method } = req.body;
  let perf = db.productPerformance.find(p => p.productCode === productCode && p.siteId === Number(siteId));
  if (!perf) {
    perf = { productCode, siteId: Number(siteId) };
    db.productPerformance.push(perf);
  }
  perf.qtyPerDay = Number(qtyPerDay);
  perf.method = method || "manual";
  perf.updatedAt = new Date().toISOString();
  res.json(perf);
});

app.post("/api/product-performance/auto-calculate", (req, res) => {
  const { siteId } = req.body;
  const sid = Number(siteId);
  const products = [...new Set(db.stockHistory.filter(h => h.siteId === sid).map(h => h.productCode))];
  const updated = [];

  products.forEach(code => {
    const hist = db.stockHistory
      .filter(h => h.siteId === sid && h.productCode === code)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));

    if (hist.length < 2) return;
    const latest = hist[0], prev = hist[1];
    const daysBetween = (new Date(latest.updatedAt) - new Date(prev.updatedAt)) / (1000 * 60 * 60 * 24);
    if (daysBetween < 0.1) return;
    const consumed = prev.qty - latest.qty;
    if (consumed <= 0) return;
    const qtyPerDay = +(consumed / daysBetween).toFixed(2);

    let perf = db.productPerformance.find(p => p.productCode === code && p.siteId === sid);
    if (!perf) { perf = { productCode: code, siteId: sid }; db.productPerformance.push(perf); }
    perf.qtyPerDay = qtyPerDay;
    perf.method = "auto";
    perf.updatedAt = new Date().toISOString();
    updated.push(code);
  });

  res.json({ updated });
});

// ─────────────────────────── Forecast ───────────────────────────
app.get("/api/forecast", (req, res) => {
  const siteId = Number(req.query.siteId);
  const site = db.sites.find(s => s.id === siteId);
  if (!site) return res.json([]);

  const rows = db.stockUpdate
    .filter(su => su.siteId === siteId)
    .map(su => {
      const prod = db.products.find(p => p.code === su.productCode) || {};
      const perf = db.productPerformance.find(p => p.productCode === su.productCode && p.siteId === siteId);
      const qtyPerDay = perf?.qtyPerDay || 0;
      const availDays = qtyPerDay > 0 ? +(su.qty / qtyPerDay).toFixed(2) : null;
      const status = statusFor(availDays, db.statusDefs);
      const preferredDays = getSitePreferredDays(siteId, su.productCode);
      const caseSize = Math.max(1, Number(prod.caseSize) || 1);

      let orderQty = 0;
      if (status === "Critical" && qtyPerDay > 0) {
        const deficit = (preferredDays * qtyPerDay) - su.qty;
        if (deficit > 0) orderQty = Math.ceil(deficit / caseSize) * caseSize;
      }

      return {
        productCode: su.productCode,
        productName: prod.name || su.productCode,
        brand: prod.brand || "",
        category: prod.category || "",
        subCategory: prod.subCategory || "",
        mrp: prod.mrp || 0,
        caseSize,
        availableQty: su.qty,
        preferredDays,
        availableDays: availDays,
        status,
        orderQty,
      };
    })
    .sort((a, b) => (a.availableDays ?? 999) - (b.availableDays ?? 999));

  res.json(rows);
});

// ─────────────────────────── Orders ───────────────────────────
app.get("/api/orders", (req, res) => {
  const siteId = req.query.siteId ? Number(req.query.siteId) : null;
  const list = siteId ? db.orders.filter(o => o.siteId === siteId) : db.orders;
  res.json(list);
});

app.post("/api/orders", (req, res) => {
  const order = {
    id: nextOrderId(),
    status: "Pending Approval",
    createdAt: new Date().toISOString(),
    feedback: "",
    ...req.body,
    siteId: Number(req.body.siteId),
  };
  db.orders.unshift(order);
  res.status(201).json(order);
});

app.put("/api/orders/:id", (req, res) => {
  const order = db.orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found" });
  Object.assign(order, req.body, { id: order.id });
  res.json(order);
});

// ─────────────────────────── Start ───────────────────────────
const PORT = 5000;
app.listen(PORT, () => console.log(`✅ Pantry API running at http://localhost:${PORT}`));
