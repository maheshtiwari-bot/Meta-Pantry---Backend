/* ============================================================
   Meta India — Pantry Inventory (Node.js backend)
   ------------------------------------------------------------
   BEGINNER NOTES:
   • This is an Express server — it exposes "API endpoints"
     (URLs) that the React frontend calls to read/save data.
   • Data is stored in a simple JavaScript object ("db" below).
     Later you can replace it with a real database like MongoDB
     or PostgreSQL without changing the API shape.

   How to run:
     1. npm install
     2. node server.js
     3. Open http://localhost:5000/api/dashboard in a browser
   ============================================================ */

const express = require("express");
const cors = require("cors");

const app = express();
app.use(cors());          // lets the React app (port 5173) talk to this server (port 5000)
app.use(express.json());  // lets us read JSON sent in request bodies

// Helper: turn "days left" into a status label
const statusFor = (days) => (days < 2 ? "Critical" : days < 4 ? "Low" : "Healthy");

// Expected gap (in days) between stock counts for a given frequency setting
const FREQ_DAYS = { Daily: 1, "Every 2 days": 2, Weekly: 7 };

// ------------------------- "Database" -------------------------
const db = {
  categories: [
    { name: "Cold Coffee", skus: 4, days: 1.2 },
    { name: "Protein Shakes", skus: 2, days: 0.8 },
    { name: "Greek Yogurt", skus: 3, days: 2.1 },
    { name: "Kombucha", skus: 2, days: 2.8 },
    { name: "Aerated Beverages", skus: 5, days: 5.4 },
    { name: "Biscuits", skus: 3, days: 6.0 },
    { name: "Herbal Tea", skus: 4, days: 7.2 },
  ],
  // ---- Sites (formerly "warehouses") ----
  sites: [],

  // ---- Sub site storages: every site gets a non-deletable "Main Site
  // Storage" (where stock-inward quantities land) plus any number of
  // user-added sub storages (mini-kitchens, floors, etc.) ----
  subStorages: [],

  // ---- Stock, tracked per (site, sub storage) ----
  stock: [],

  // ---- Stock count history (per site / sub storage, "all" = combined) ----
  stockHistory: [],

  // ---- "All (Main + Sub Site Storages)" combined snapshot records ----
  siteStockTotals: [],

  // ---- Master data for the "Add GRN" form ----
  vendors: [
    { id: 1, name: "Anshul Enterprises" },
    { id: 2, name: "Sodexo Supplies" },
    { id: 3, name: "FreshMart Distributors" },
  ],

  // ---- Product taxonomy (uploaded via Admin > Product Taxonomy) ----
  productTaxonomy: [],

  // ---- Vendor orders placed from the Distribute tab (Main Site Storage) ----
  vendorOrders: [],

  // ---- Monthly stock inward records (CSV upload or manual entry,
  // confirmed into Main Site Storage) ----
  stockInwards: [],
};

// ------------------------- Endpoints -------------------------

// GET dashboard data (stats + category health) — every stat below is
// derived live from db.stock / db.categories, so it updates whenever
// stock counts or category days change (e.g. after a stock count or
// GRN acknowledgement).
app.get("/api/dashboard", (req, res) => {
  const enriched = db.categories.map((c) => ({ ...c, status: statusFor(c.days) }));

  const totalValue = db.stock.reduce((sum, s) => sum + s.count * (s.price || 0), 0);
  const avgDays = enriched.length
    ? enriched.reduce((sum, c) => sum + c.days, 0) / enriched.length
    : 0;

  const recentStockInwards = db.stockInwards.slice(0, 5);
  const recentVendorOrders = db.vendorOrders.slice(0, 5);

  res.json({
    totalStockValue: `₹${totalValue.toLocaleString("en-IN")}`,
    daysOverall: +avgDays.toFixed(1),
    categoriesLow: enriched.filter((c) => c.status !== "Healthy").length,
    categoriesHealthy: enriched.filter((c) => c.status === "Healthy").length,
    categories: enriched,
    recentStockInwards,
    recentVendorOrders,
  });
});

// GET stock for a site + sub storage (or subStorageId=all for the
// combined Main + every sub storage view)
app.get("/api/stock", (req, res) => {
  const siteId = Number(req.query.siteId);
  const { subStorageId } = req.query;

  const withDaysStatus = (r) => {
    const days = r.rate > 0 ? +(r.count / r.rate).toFixed(1) : 0;
    return { ...r, days, status: statusFor(days) };
  };

  if (subStorageId === "all") {
    const grouped = {};
    db.stock
      .filter((s) => s.siteId === siteId)
      .forEach((r) => {
        if (!grouped[r.product]) {
          grouped[r.product] = {
            product: r.product,
            category: r.category,
            subCategory: r.subCategory,
            min: r.min,
            rate: r.rate,
            price: r.price,
            count: 0,
          };
        }
        grouped[r.product].count += r.count;
      });
    return res.json(Object.values(grouped).map(withDaysStatus));
  }

  const subId = Number(subStorageId);
  const rows = db.stock
    .filter((s) => s.siteId === siteId && s.subStorageId === subId)
    .map(withDaysStatus);
  res.json(rows);
});

// POST submit a new physical stock count for a site + sub storage
// expects: { siteId, subStorageId, person, items: [{ product, category, subCategory, count }] }
app.post("/api/stock", (req, res) => {
  const { siteId, subStorageId, person, items } = req.body || {};
  const sId = Number(siteId);
  const itemsArr = Array.isArray(items) ? items : [];

  if (subStorageId === "all") {
    itemsArr.forEach((it) => {
      let rec = db.siteStockTotals.find((t) => t.siteId === sId && t.product === it.product);
      if (!rec) {
        rec = { siteId: sId, product: it.product, category: it.category, subCategory: it.subCategory, count: 0 };
        db.siteStockTotals.push(rec);
      }
      rec.category = it.category;
      rec.subCategory = it.subCategory;
      rec.count = Number(it.count) || 0;
      rec.updatedAt = new Date().toISOString();
      rec.updatedBy = person;
    });
  } else {
    const subId = Number(subStorageId);
    itemsArr.forEach((it) => {
      let row = db.stock.find((s) => s.siteId === sId && s.subStorageId === subId && s.product === it.product);
      if (!row) {
        row = {
          siteId: sId,
          subStorageId: subId,
          product: it.product,
          category: it.category,
          subCategory: it.subCategory,
          min: "0 units",
          count: 0,
          rate: 0,
          price: 0,
        };
        db.stock.push(row);
      }
      row.category = it.category;
      row.subCategory = it.subCategory;

      const newCount = Number(it.count) || 0;
      // Recompute the daily consumption rate from how much was used since the
      // last count (ignored if the count went up, e.g. after a distribution/GRN)
      if (row.updatedAt) {
        const daysSince = (Date.now() - new Date(row.updatedAt).getTime()) / (1000 * 60 * 60 * 24);
        const consumed = row.count - newCount;
        if (daysSince > 0.1 && consumed > 0) {
          row.rate = +(consumed / daysSince).toFixed(2);
        }
      }

      row.count = newCount;
      row.updatedAt = new Date().toISOString();
      row.updatedBy = person;
    });
  }

  db.stockHistory.unshift({
    id: Date.now(),
    siteId: sId,
    subStorageId: subStorageId === "all" ? "all" : Number(subStorageId),
    person,
    date: new Date().toISOString(),
    itemCount: itemsArr.length,
  });

  res.json({ message: "Stock count submitted" });
});

// GET stock count history + "pending" summary for a site
app.get("/api/stock/history", (req, res) => {
  const siteId = Number(req.query.siteId);
  const subs = db.subStorages.filter((s) => s.siteId === siteId);

  const history = db.stockHistory
    .filter((h) => h.siteId === siteId)
    .map((h) => {
      const name =
        h.subStorageId === "all"
          ? "All (Main + Sub Site Storages)"
          : subs.find((s) => s.id === h.subStorageId)?.name ?? `#${h.subStorageId}`;
      return { ...h, subStorageName: name };
    })
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  const pendingSummary = subs.map((sub) => {
    const last = db.stockHistory
      .filter((h) => h.siteId === siteId && h.subStorageId === sub.id)
      .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    const expected = FREQ_DAYS[sub.freq] ?? 7;
    let daysSince = null;
    let pending = true;
    if (last) {
      daysSince = (Date.now() - new Date(last.date).getTime()) / (1000 * 60 * 60 * 24);
      pending = daysSince > expected;
    }
    return {
      subStorageId: sub.id,
      name: sub.name,
      isMain: sub.isMain,
      lastUpdated: last ? last.date : null,
      person: last ? last.person : null,
      freq: sub.freq,
      pending,
      daysSince: daysSince !== null ? +daysSince.toFixed(1) : null,
    };
  });

  res.json({ history, pendingSummary });
});

// GET product performance: average sale (consumption) per day per SKU,
// measured at site level (summed across that site's sub site storages).
// /api/performance?siteId=&category=&subCategory=
app.get("/api/performance", (req, res) => {
  const siteId = Number(req.query.siteId);
  const { category, subCategory } = req.query;

  const grouped = {};
  db.stock
    .filter((s) => s.siteId === siteId)
    .filter((s) => !category || category === "All" || s.category === category)
    .filter((s) => !subCategory || subCategory === "All" || s.subCategory === subCategory)
    .forEach((r) => {
      if (!grouped[r.product]) {
        grouped[r.product] = { product: r.product, category: r.category, subCategory: r.subCategory, ratePerDay: 0 };
      }
      grouped[r.product].ratePerDay += r.rate || 0;
    });

  const rows = Object.values(grouped)
    .map((r) => ({ ...r, ratePerDay: +r.ratePerDay.toFixed(2) }))
    .sort((a, b) => b.ratePerDay - a.ratePerDay);

  res.json(rows);
});

// GET reorder forecast for a site + sub storage (or subStorageId=all for the
// whole site). Recommends pulling from Main Site Storage or ordering from a
// vendor, based on available qty, avg sale/day and the storage's min-days target.
// /api/forecast?siteId=&subStorageId=
app.get("/api/forecast", (req, res) => {
  const siteId = Number(req.query.siteId);
  const { subStorageId } = req.query;
  const main = db.subStorages.find((s) => s.siteId === siteId && s.isMain);

  const withForecast = (r, minDays, isMainStorage) => {
    const days = r.rate > 0 ? +(r.count / r.rate).toFixed(1) : null;
    const reorderTarget = minDays * 2;
    let recommendation = "Stock healthy — no action needed";
    let suggestedQty = 0;
    let source = "none";

    if (days === null) {
      recommendation = "No consumption data yet";
    } else if (days < minDays) {
      suggestedQty = Math.max(0, Math.ceil((reorderTarget - days) * r.rate));
      if (suggestedQty > 0) {
        const mainRow = !isMainStorage && main
          ? db.stock.find((s) => s.siteId === siteId && s.subStorageId === main.id && s.product === r.product)
          : null;
        const mainAvail = mainRow ? mainRow.count : 0;

        if (mainAvail > 0) {
          const fromMain = Math.min(suggestedQty, mainAvail);
          const fromVendor = suggestedQty - fromMain;
          if (fromVendor > 0) {
            recommendation = `Request ${fromMain} units from Main Site Storage + order ${fromVendor} units from Vendor`;
            source = "main+vendor";
          } else {
            recommendation = `Request ${fromMain} units from Main Site Storage`;
            source = "main";
          }
        } else {
          recommendation = `Order ${suggestedQty} units from Vendor`;
          source = "vendor";
        }
      }
    }

    return {
      product: r.product,
      category: r.category,
      subCategory: r.subCategory,
      available: r.count,
      ratePerDay: r.rate,
      days,
      status: days !== null ? statusFor(days) : "Unknown",
      minDays,
      recommendation,
      suggestedQty,
      source,
    };
  };

  if (subStorageId === "all") {
    const grouped = {};
    db.stock
      .filter((s) => s.siteId === siteId)
      .forEach((r) => {
        if (!grouped[r.product]) {
          grouped[r.product] = { product: r.product, category: r.category, subCategory: r.subCategory, count: 0, rate: 0 };
        }
        grouped[r.product].count += r.count;
        grouped[r.product].rate += r.rate || 0;
      });
    const minDays = main?.minDays ?? 2;
    const rows = Object.values(grouped)
      .map((r) => withForecast(r, minDays, true))
      .sort((a, b) => (a.days ?? Infinity) - (b.days ?? Infinity));
    return res.json(rows);
  }

  const subId = Number(subStorageId);
  const sub = db.subStorages.find((s) => s.id === subId);
  const minDays = sub?.minDays ?? 2;
  const rows = db.stock
    .filter((s) => s.siteId === siteId && s.subStorageId === subId)
    .map((r) => withForecast(r, minDays, !!sub?.isMain))
    .sort((a, b) => (a.days ?? Infinity) - (b.days ?? Infinity));
  res.json(rows);
});

// ---- Sites CRUD (Admin panel; formerly "Warehouses") ----
app.get("/api/sites", (req, res) => res.json(db.sites));

app.post("/api/sites", (req, res) => {
  const site = { id: Date.now(), ...req.body };
  db.sites.push(site);
  db.subStorages.push({
    id: Date.now() + 1,
    siteId: site.id,
    name: "Main Site Storage",
    isMain: true,
    supervisor: "",
    contact: "",
    minDays: 2,
    freq: "Weekly",
    capacity: 500,
  });
  res.status(201).json(site);
});

app.put("/api/sites/:id", (req, res) => {
  const site = db.sites.find((s) => s.id === Number(req.params.id));
  if (!site) return res.status(404).json({ error: "Site not found" });
  Object.assign(site, req.body);
  res.json(site);
});

app.delete("/api/sites/:id", (req, res) => {
  const id = Number(req.params.id);
  db.sites = db.sites.filter((s) => s.id !== id);
  db.subStorages = db.subStorages.filter((ss) => ss.siteId !== id);
  db.stock = db.stock.filter((s) => s.siteId !== id);
  res.json({ message: "Site deleted" });
});

// ---- Sub site storages CRUD (Settings tab) ----
app.get("/api/sites/:siteId/sub-storages", (req, res) => {
  const siteId = Number(req.params.siteId);
  const subs = db.subStorages.filter((s) => s.siteId === siteId);
  subs.sort((a, b) => Number(b.isMain) - Number(a.isMain));
  res.json(subs);
});

app.post("/api/sites/:siteId/sub-storages", (req, res) => {
  const siteId = Number(req.params.siteId);
  const sub = {
    supervisor: "",
    contact: "",
    minDays: 2,
    freq: "Weekly",
    capacity: 100,
    ...req.body,
    id: Date.now(),
    siteId,
    isMain: false,
  };
  db.subStorages.push(sub);
  res.status(201).json(sub);
});

app.put("/api/sub-storages/:id", (req, res) => {
  const sub = db.subStorages.find((s) => s.id === Number(req.params.id));
  if (!sub) return res.status(404).json({ error: "Sub site storage not found" });
  Object.assign(sub, req.body, { isMain: sub.isMain });
  res.json(sub);
});

app.delete("/api/sub-storages/:id", (req, res) => {
  const sub = db.subStorages.find((s) => s.id === Number(req.params.id));
  if (!sub) return res.status(404).json({ error: "Sub site storage not found" });
  if (sub.isMain) return res.status(400).json({ error: "Cannot delete Main Site Storage" });
  db.subStorages = db.subStorages.filter((s) => s.id !== sub.id);
  db.stock = db.stock.filter((s) => s.subStorageId !== sub.id);
  res.json({ message: "Sub site storage deleted" });
});

// GET auto-distribute suggestions for a site + sub site storage.
// For every SKU present anywhere at the site, shows the qty available at
// the selected storage, its avg sale/day there, days of stock, and a
// suggested reorder/restock qty (rounded up to whole cases) needed to
// reach `targetDays` days of stock at that storage.
// /api/sites/:siteId/auto-distribute?subStorageId=&targetDays=
app.get("/api/sites/:siteId/auto-distribute", (req, res) => {
  const siteId = Number(req.params.siteId);
  const subStorageId = Number(req.query.subStorageId);
  const targetDays = Number(req.query.targetDays) || 2;

  const main = db.subStorages.find((s) => s.siteId === siteId && s.isMain);
  const sub = db.subStorages.find((s) => s.id === subStorageId);
  const isMain = !!sub?.isMain;

  const products = [...new Set(db.stock.filter((s) => s.siteId === siteId).map((s) => s.product))];

  const rows = products.map((product) => {
    const row = db.stock.find((s) => s.siteId === siteId && s.subStorageId === subStorageId && s.product === product);
    const anyRow = row || db.stock.find((s) => s.siteId === siteId && s.product === product);

    const available = row ? row.count : 0;
    const rate = row ? row.rate || 0 : 0;
    const days = rate > 0 ? +(available / rate).toFixed(1) : null;

    const taxonomy = db.productTaxonomy.find((p) => p.sku === product);
    const caseSize = Math.max(1, Number(taxonomy?.caseSize) || 1);

    const deficit = rate > 0 ? Math.max(0, (targetDays - (days ?? 0)) * rate) : 0;
    const suggestedQty = Math.ceil(deficit / caseSize) * caseSize;

    const result = {
      product,
      category: anyRow.category,
      subCategory: anyRow.subCategory,
      caseSize,
      available,
      ratePerDay: rate,
      days,
      suggestedQty,
    };

    if (!isMain && main) {
      const mainRow = db.stock.find((s) => s.siteId === siteId && s.subStorageId === main.id && s.product === product);
      result.mainAvailable = mainRow ? mainRow.count : 0;
    }

    return result;
  });

  res.json({ siteId, subStorageId, isMain, rows });
});

// POST confirm restocking a sub site storage from Main Site Storage,
// expects: { subStorageId, items: [{ product, qty }] }. `qty` is the
// additional quantity to move from Main into the sub storage (capped to
// what Main actually has available).
app.post("/api/sites/:siteId/auto-distribute/confirm", (req, res) => {
  const siteId = Number(req.params.siteId);
  const { subStorageId, items } = req.body || {};
  const subId = Number(subStorageId);
  const main = db.subStorages.find((s) => s.siteId === siteId && s.isMain);
  if (!main) return res.status(404).json({ error: "Site has no Main Site Storage" });
  if (subId === main.id) return res.status(400).json({ error: "Cannot distribute to Main Site Storage" });

  (items || []).forEach((it) => {
    const qty = Math.max(0, Number(it.qty) || 0);
    if (qty <= 0) return;
    const mainRow = db.stock.find((s) => s.siteId === siteId && s.subStorageId === main.id && s.product === it.product);
    if (!mainRow) return;
    const move = Math.min(qty, mainRow.count);
    if (move <= 0) return;

    let subRow = db.stock.find((s) => s.siteId === siteId && s.subStorageId === subId && s.product === it.product);
    if (!subRow) {
      subRow = {
        siteId,
        subStorageId: subId,
        product: mainRow.product,
        category: mainRow.category,
        subCategory: mainRow.subCategory,
        min: mainRow.min,
        count: 0,
        rate: mainRow.rate,
        price: mainRow.price,
      };
      db.stock.push(subRow);
    }
    subRow.count += move;
    mainRow.count -= move;
  });

  res.json({ message: "Stock distributed from Main Site Storage" });
});

// GET all vendor orders placed (most recent first) — used by the
// Dashboard "Vendor Orders / Demand" snapshot
app.get("/api/vendor-orders", (req, res) => res.json(db.vendorOrders));

// POST place a vendor order from Main Site Storage,
// expects: { siteId, items: [{ product, category, subCategory, qty }] }
app.post("/api/vendor-orders", (req, res) => {
  const { siteId, items } = req.body || {};
  const order = {
    id: Date.now(),
    siteId: Number(siteId),
    site: db.sites.find((s) => s.id === Number(siteId))?.name,
    vendor: "Vendiman",
    items: items || [],
    status: "Placed",
    placedAt: new Date().toISOString(),
  };
  db.vendorOrders.unshift(order);
  res.status(201).json({ message: "Order placed — Vendiman has been notified", order });
});

// ---- Vendors CRUD (Admin panel) ----
app.get("/api/vendors", (req, res) => res.json(db.vendors));

app.post("/api/vendors", (req, res) => {
  const vendor = { id: Date.now(), ...req.body };
  db.vendors.push(vendor);
  res.status(201).json(vendor);
});

app.put("/api/vendors/:id", (req, res) => {
  const vendor = db.vendors.find((v) => v.id === Number(req.params.id));
  if (!vendor) return res.status(404).json({ error: "Vendor not found" });
  Object.assign(vendor, req.body);
  res.json(vendor);
});

app.delete("/api/vendors/:id", (req, res) => {
  db.vendors = db.vendors.filter((v) => v.id !== Number(req.params.id));
  res.json({ message: "Vendor deleted" });
});

// ---- Stock Inward (monthly stock receiving via CSV upload or manual entry) ----

// GET stock inward history for a site, most recent first
app.get("/api/sites/:siteId/stock-inward/history", (req, res) => {
  const siteId = Number(req.params.siteId);
  res.json(db.stockInwards.filter((h) => h.siteId === siteId));
});

// POST confirm a stock inward — adds the given quantities into the site's
// Main Site Storage and bumps the matching category's "days remaining".
// expects: { items: [{ sku, code, category, subCategory, qty }], source }
app.post("/api/sites/:siteId/stock-inward", (req, res) => {
  const siteId = Number(req.params.siteId);
  const { items, source } = req.body || {};
  const site = db.sites.find((s) => s.id === siteId);
  if (!site) return res.status(404).json({ error: "Site not found" });

  const main = db.subStorages.find((s) => s.siteId === siteId && s.isMain);
  if (!main) return res.status(404).json({ error: "Site has no Main Site Storage" });

  const itemsArr = (Array.isArray(items) ? items : []).filter((it) => Number(it.qty) > 0);

  itemsArr.forEach((item) => {
    const qty = Number(item.qty) || 0;
    const taxonomy = db.productTaxonomy.find((p) => p.sku === item.sku);

    let row = db.stock.find(
      (s) => s.siteId === siteId && s.subStorageId === main.id && s.product === item.sku
    );
    if (!row) {
      row = {
        siteId,
        subStorageId: main.id,
        product: item.sku,
        code: item.code || taxonomy?.code || "",
        category: item.category || taxonomy?.category || "",
        subCategory: item.subCategory || taxonomy?.subCategory || "",
        min: "0 units",
        count: 0,
        rate: 0,
        price: taxonomy?.mrp || 0,
        updatedAt: null,
        updatedBy: null,
      };
      db.stock.push(row);
    }
    row.count += qty;
    row.updatedAt = new Date().toISOString();
    row.updatedBy = "Stock Inward";

    const cat = db.categories.find((c) => c.name === row.category);
    if (cat) cat.days = +(cat.days + qty / 20).toFixed(1);
  });

  const record = {
    id: Date.now(),
    siteId,
    site: site.name,
    date: new Date().toISOString(),
    source: source === "manual" ? "Manual" : "CSV upload",
    itemCount: itemsArr.length,
    totalQty: itemsArr.reduce((sum, it) => sum + (Number(it.qty) || 0), 0),
  };
  db.stockInwards.unshift(record);

  res.json({ message: "Stock inwarded — added to Main Site Storage", record });
});

// ---- Product taxonomy (Admin panel: upload/download Excel) ----

// GET current product taxonomy
app.get("/api/products/taxonomy", (req, res) => res.json(db.productTaxonomy));

// POST replace product taxonomy with rows parsed from the uploaded Excel file
// expects: [{ sku, category, subCategory, mrp, caseSize }, ...]
// Each row is assigned a backend-generated unique "code" that can be used to
// reference the product elsewhere (stock, performance, forecast, etc.)
app.post("/api/products/taxonomy", (req, res) => {
  const rows = Array.isArray(req.body) ? req.body : [];
  db.productTaxonomy = rows.map((r, i) => ({
    code: `SKU${String(i + 1).padStart(4, "0")}`,
    sku: String(r.sku ?? "").trim(),
    category: String(r.category ?? "").trim(),
    subCategory: String(r.subCategory ?? "").trim(),
    mrp: Number(r.mrp) || 0,
    caseSize: Number(r.caseSize) || 0,
  }));
  res.json({ message: "Product taxonomy imported", count: db.productTaxonomy.length });
});

// ------------------------- Start -------------------------
const PORT = 5000;
app.listen(PORT, () => console.log(`✅ Pantry API running at http://localhost:${PORT}`));
