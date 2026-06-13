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
  grn: {
    id: "SDX-2406-0047",
    from: "Bengaluru DC",
    status: "In transit",
    items: [
      { product: "Sleepy Owl Cold Brew Black", category: "Cold Coffee", qty: 48 },
      { product: "Epigamia Greek Yogurt – Mango", category: "Greek Yogurt", qty: 34 },
      { product: "Tetley Green Tea Immune", category: "Herbal Tea", qty: 24 },
      { product: "Nectaras Kombucha Ginger", category: "Kombucha", qty: 60 },
      { product: "Britannia Good Day Cookies", category: "Biscuits", qty: 72 },
    ],
  },

  // ---- Sites (formerly "warehouses") ----
  sites: [
    { id: 1, name: "Goa Airport" },
    { id: 2, name: "Bengaluru DC" },
    { id: 3, name: "Mumbai BKC" },
  ],

  // ---- Sub site storages: every site gets a non-deletable "Main Site
  // Storage" (where GRN-acknowledged stock lands) plus any number of
  // user-added sub storages (mini-kitchens, floors, etc.) ----
  subStorages: [
    { id: 1, siteId: 1, name: "Main Site Storage", isMain: true, supervisor: "", contact: "", minDays: 2, freq: "Weekly", capacity: 500 },
    { id: 2, siteId: 2, name: "Main Site Storage", isMain: true, supervisor: "", contact: "", minDays: 2, freq: "Weekly", capacity: 500 },
    { id: 3, siteId: 3, name: "Main Site Storage", isMain: true, supervisor: "", contact: "", minDays: 2, freq: "Weekly", capacity: 500 },
    { id: 4, siteId: 1, name: "Floor 3 — Main Pantry", isMain: false, supervisor: "Ravi Kumar", contact: "+91 98400 00001", minDays: 3, freq: "Every 2 days", capacity: 500 },
    { id: 5, siteId: 1, name: "Floor 6 — Mini Kitchen", isMain: false, supervisor: "Priya Nair", contact: "+91 98400 00002", minDays: 2, freq: "Weekly", capacity: 250 },
    { id: 6, siteId: 1, name: "Floor 9 — Café Corner", isMain: false, supervisor: "Ankit Sharma", contact: "+91 98400 00003", minDays: 2, freq: "Weekly", capacity: 200 },
  ],

  // ---- Stock, tracked per (site, sub storage) ----
  stock: [
    { siteId: 1, subStorageId: 1, product: "Sleepy Owl Cold Brew", category: "Cold Coffee", subCategory: "Cold Brew", min: "10 units", count: 8, rate: 6, price: 180, updatedAt: null, updatedBy: null },
    { siteId: 1, subStorageId: 1, product: "Epigamia Greek Yogurt", category: "Greek Yogurt", subCategory: "Plain", min: "8 units", count: 14, rate: 5, price: 60, updatedAt: null, updatedBy: null },
    { siteId: 1, subStorageId: 1, product: "Nectaras Kombucha", category: "Kombucha", subCategory: "Ginger", min: "12 units", count: 22, rate: 8, price: 120, updatedAt: null, updatedBy: null },
    { siteId: 1, subStorageId: 1, product: "Tetley Green Tea", category: "Herbal Tea", subCategory: "Green Tea", min: "6 boxes", count: 18, rate: 2, price: 250, updatedAt: null, updatedBy: null },
    { siteId: 1, subStorageId: 1, product: "Britannia Good Day", category: "Biscuits", subCategory: "Cookies", min: "10 packs", count: 42, rate: 6, price: 40, updatedAt: null, updatedBy: null },
  ],

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
  purchaseOrders: [
    { id: 1, number: "PO/1/450/2026-27/0006342", vendorId: 1, date: "2026-06-08" },
    { id: 2, number: "PO/1/451/2026-27/0006343", vendorId: 2, date: "2026-06-09" },
    { id: 3, number: "PO/1/452/2026-27/0006344", vendorId: 3, date: "2026-06-10" },
  ],
  products: [
    { barcode: "8901030875024", name: "Sleepy Owl Cold Brew Black", category: "Cold Coffee" },
    { barcode: "8901030875031", name: "Epigamia Greek Yogurt – Mango", category: "Greek Yogurt" },
    { barcode: "8901030875048", name: "Tetley Green Tea Immune", category: "Herbal Tea" },
    { barcode: "8901030875055", name: "Nectaras Kombucha Ginger", category: "Kombucha" },
    { barcode: "8901030875062", name: "Britannia Good Day Cookies", category: "Biscuits" },
  ],

  // ---- GRNs created via the "Add GRN" form ----
  grns: [],

  // ---- Product taxonomy (uploaded via Admin > Product Taxonomy) ----
  productTaxonomy: [],
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

  res.json({
    totalStockValue: `₹${totalValue.toLocaleString("en-IN")}`,
    daysOverall: +avgDays.toFixed(1),
    categoriesLow: enriched.filter((c) => c.status !== "Healthy").length,
    categoriesHealthy: enriched.filter((c) => c.status === "Healthy").length,
    categories: enriched,
  });
});

// GET pending GRN
app.get("/api/grn", (req, res) => res.json(db.grn));

// POST acknowledge GRN → adds received qty into the Main Site Storage of
// the site the GRN came from, and bumps category "days remaining"
app.post("/api/grn/acknowledge", (req, res) => {
  const site = db.sites.find((s) => s.name === db.grn.from);
  const main = site ? db.subStorages.find((ss) => ss.siteId === site.id && ss.isMain) : null;

  db.grn.items.forEach((item) => {
    if (main) {
      let row = db.stock.find(
        (s) => s.siteId === site.id && s.subStorageId === main.id && s.category === item.category
      );
      if (!row) {
        row = {
          siteId: site.id,
          subStorageId: main.id,
          product: item.product,
          category: item.category,
          subCategory: "",
          min: "0 units",
          count: 0,
          rate: 1,
          price: 0,
          updatedAt: null,
          updatedBy: null,
        };
        db.stock.push(row);
      }
      row.count += item.qty;
      row.updatedAt = new Date().toISOString();
      row.updatedBy = "GRN";
    }

    const cat = db.categories.find((c) => c.name === item.category);
    if (cat) cat.days = +(cat.days + item.qty / 20).toFixed(1);
  });

  db.grn.status = "Received";
  res.json({ message: "GRN acknowledged, stock updated", grn: db.grn });
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

// GET the distribute board for a site: Main Site Storage's available stock
// plus the site's other sub storages and their current allocation per product
app.get("/api/sites/:siteId/distribute-board", (req, res) => {
  const siteId = Number(req.params.siteId);
  const main = db.subStorages.find((s) => s.siteId === siteId && s.isMain);
  const subs = db.subStorages.filter((s) => s.siteId === siteId && !s.isMain);

  const rows = db.stock
    .filter((s) => s.siteId === siteId && s.subStorageId === main?.id)
    .map((r) => ({
      product: r.product,
      category: r.category,
      subCategory: r.subCategory,
      available: r.count,
      allocations: subs.map((sub) => {
        const subRow = db.stock.find(
          (s) => s.siteId === siteId && s.subStorageId === sub.id && s.product === r.product
        );
        return { subStorageId: sub.id, qty: subRow ? subRow.count : 0 };
      }),
    }));

  res.json({ subStorages: subs, rows });
});

// POST confirm a distribution from Main Site Storage to sub storages
// expects: { siteId, allocations: [{ product, subStorageId, qty }] }
app.post("/api/distribute", (req, res) => {
  const { siteId, allocations } = req.body || {};
  const sId = Number(siteId);
  const main = db.subStorages.find((s) => s.siteId === sId && s.isMain);
  if (!main) return res.status(404).json({ error: "Site has no Main Site Storage" });

  (allocations || []).forEach((a) => {
    const mainRow = db.stock.find((s) => s.siteId === sId && s.subStorageId === main.id && s.product === a.product);
    if (!mainRow) return;

    const subStorageId = Number(a.subStorageId);
    let subRow = db.stock.find((s) => s.siteId === sId && s.subStorageId === subStorageId && s.product === a.product);
    const prevQty = subRow ? subRow.count : 0;
    const newQty = Number(a.qty) || 0;
    const delta = newQty - prevQty;

    if (!subRow) {
      subRow = {
        siteId: sId,
        subStorageId,
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
    subRow.count = newQty;
    mainRow.count -= delta;
  });

  res.json({ message: "Distribution confirmed" });
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

// GET purchase orders, optionally filtered by vendor: /api/purchase-orders?vendorId=1
app.get("/api/purchase-orders", (req, res) => {
  const { vendorId } = req.query;
  const pos = vendorId
    ? db.purchaseOrders.filter((p) => p.vendorId === Number(vendorId))
    : db.purchaseOrders;
  res.json(pos);
});

// GET products, optionally searched by barcode or name: /api/products?search=8901
app.get("/api/products", (req, res) => {
  const { search } = req.query;
  if (!search) return res.json(db.products);
  const q = search.toLowerCase();
  res.json(db.products.filter((p) => p.barcode.includes(q) || p.name.toLowerCase().includes(q)));
});

// GET all GRNs created via the "Add GRN" form
app.get("/api/grns", (req, res) => res.json(db.grns));

// POST create a new GRN
app.post("/api/grns", (req, res) => {
  const grn = { id: `GRN-${Date.now()}`, status: "Pending", ...req.body };
  db.grns.unshift(grn);
  res.status(201).json(grn);
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
