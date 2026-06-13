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
  stock: [
    { product: "Sleepy Owl Cold Brew", category: "Cold Coffee", min: "10 units", count: 8, rate: 6, price: 180 },
    { product: "Epigamia Greek Yogurt", category: "Greek Yogurt", min: "8 units", count: 14, rate: 5, price: 60 },
    { product: "Nectaras Kombucha", category: "Kombucha", min: "12 units", count: 22, rate: 8, price: 120 },
    { product: "Tetley Green Tea", category: "Herbal Tea", min: "6 boxes", count: 18, rate: 2, price: 250 },
    { product: "Britannia Good Day", category: "Biscuits", min: "10 packs", count: 42, rate: 6, price: 40 },
  ],
  locations: [
    { id: 1, name: "Floor 3 — Main Pantry", supervisor: "Ravi Kumar", contact: "+91 98400 00001", minDays: 3, freq: "Every 2 days", capacity: 500 },
    { id: 2, name: "Floor 6 — Mini Kitchen", supervisor: "Priya Nair", contact: "+91 98400 00002", minDays: 2, freq: "Weekly", capacity: 250 },
    { id: 3, name: "Floor 9 — Café Corner", supervisor: "Ankit Sharma", contact: "+91 98400 00003", minDays: 2, freq: "Weekly", capacity: 200 },
  ],

  // ---- Master data for the "Add GRN" form ----
  warehouses: [
    { id: 1, name: "Goa Airport" },
    { id: 2, name: "Bengaluru DC" },
    { id: 3, name: "Mumbai BKC" },
  ],
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
};

// Helper: turn "days left" into a status label
const statusFor = (days) => (days < 2 ? "Critical" : days < 4 ? "Low" : "Healthy");

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

// POST acknowledge GRN → adds received qty into stock counts
app.post("/api/grn/acknowledge", (req, res) => {
  db.grn.items.forEach((item) => {
    const row = db.stock.find((s) => s.category === item.category);
    if (row) row.count += item.qty;

    const cat = db.categories.find((c) => c.name === item.category);
    if (cat) cat.days = +(cat.days + item.qty / 20).toFixed(1);
  });
  db.grn.status = "Received";
  res.json({ message: "GRN acknowledged, stock updated", grn: db.grn });
});

// GET stock for a location (days left calculated by the server)
app.get("/api/stock", (req, res) => {
  const rows = db.stock.map((r) => {
    const days = r.rate > 0 ? +(r.count / r.rate).toFixed(1) : 0;
    return { ...r, days, status: statusFor(days) };
  });
  res.json(rows);
});

// POST submit a new physical stock count
app.post("/api/stock", (req, res) => {
  // expects: [{ product: "Sleepy Owl Cold Brew", count: 12 }, ...]
  (req.body || []).forEach((u) => {
    const row = db.stock.find((s) => s.product === u.product);
    if (row) row.count = u.count;
  });
  res.json({ message: "Stock count submitted" });
});

// POST confirm a distribution to floors
app.post("/api/distribute", (req, res) => {
  // expects: [{ product, floors: [20,16,12] }, ...]
  res.json({ message: "Distribution confirmed", allocation: req.body });
});

// ---- Warehouses CRUD (Admin panel) ----
app.get("/api/warehouses", (req, res) => res.json(db.warehouses));

app.post("/api/warehouses", (req, res) => {
  const wh = { id: Date.now(), ...req.body };
  db.warehouses.push(wh);
  res.status(201).json(wh);
});

app.put("/api/warehouses/:id", (req, res) => {
  const wh = db.warehouses.find((w) => w.id === Number(req.params.id));
  if (!wh) return res.status(404).json({ error: "Warehouse not found" });
  Object.assign(wh, req.body);
  res.json(wh);
});

app.delete("/api/warehouses/:id", (req, res) => {
  db.warehouses = db.warehouses.filter((w) => w.id !== Number(req.params.id));
  res.json({ message: "Warehouse deleted" });
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

// Locations CRUD (Create, Read, Update, Delete)
app.get("/api/locations", (req, res) => res.json(db.locations));

app.post("/api/locations", (req, res) => {
  const loc = { id: Date.now(), ...req.body };
  db.locations.push(loc);
  res.status(201).json(loc);
});

app.put("/api/locations/:id", (req, res) => {
  const loc = db.locations.find((l) => l.id === Number(req.params.id));
  if (!loc) return res.status(404).json({ error: "Location not found" });
  Object.assign(loc, req.body);
  res.json(loc);
});

app.delete("/api/locations/:id", (req, res) => {
  db.locations = db.locations.filter((l) => l.id !== Number(req.params.id));
  res.json({ message: "Location deleted" });
});

// ------------------------- Start -------------------------
const PORT = 5000;
app.listen(PORT, () => console.log(`✅ Pantry API running at http://localhost:${PORT}`));
