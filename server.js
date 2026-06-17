const express = require("express");
const cors    = require("cors");
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(express.json());

// ─── PostgreSQL connection ─────────────────────────────────────────────────
// Render injects DATABASE_URL automatically when you link a Postgres database.
// For local dev, set DATABASE_URL in a .env file or shell export.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

// ─── Helpers ──────────────────────────────────────────────────────────────
const statusFor = (days, defs) => {
  if (days === null || days === undefined) return "Unknown";
  const d = Number(days);
  if (d <= Number(defs.critical_to))   return "Critical";
  if (d >= Number(defs.excessive_from)) return "Excessive";
  return "Healthy";
};

const getStatusDefs = async () => {
  const r = await pool.query("SELECT * FROM status_defs WHERE id = 1");
  return r.rows[0] || { critical_from:0, critical_to:2, healthy_from:2, healthy_to:7, excessive_from:7, excessive_to:9999 };
};

const mapProduct = (p) => ({
  id: p.id, code: p.code, name: p.name,
  brand: p.brand||"", category: p.category||"", subCategory: p.sub_category||"",
  mrp: parseFloat(p.mrp)||0, caseSize: parseFloat(p.case_size)||0,
  uom: p.uom||"", hsnCode: p.hsn_code||"",
  gst: parseFloat(p.gst)||0, weight: p.weight||"", status: p.status||"Active",
});

let _orderSeq = 1;
const nextOrderId = () => `ORD-${Date.now().toString(36).toUpperCase()}`;

// ─── Database initialisation (runs on startup) ────────────────────────────
async function initDB() {
  const client = await pool.connect();
  try {
    // Create all tables
    await client.query(`
      CREATE TABLE IF NOT EXISTS sites (
        id            SERIAL PRIMARY KEY,
        name          VARCHAR(255) UNIQUE NOT NULL,
        preferred_days INTEGER DEFAULT 5
      );

      CREATE TABLE IF NOT EXISTS products (
        id           SERIAL PRIMARY KEY,
        code         VARCHAR(100) UNIQUE NOT NULL,
        name         VARCHAR(255) UNIQUE NOT NULL,
        brand        VARCHAR(255) DEFAULT '',
        category     VARCHAR(255) DEFAULT '',
        sub_category VARCHAR(255) DEFAULT '',
        mrp          NUMERIC(10,2) DEFAULT 0,
        case_size    NUMERIC(10,2) DEFAULT 1,
        uom          VARCHAR(50)  DEFAULT '',
        hsn_code     VARCHAR(50)  DEFAULT '',
        gst          NUMERIC(5,2) DEFAULT 0,
        weight       VARCHAR(50)  DEFAULT '',
        status       VARCHAR(20)  DEFAULT 'Active'
      );

      CREATE TABLE IF NOT EXISTS vendors (
        id       SERIAL PRIMARY KEY,
        name     VARCHAR(255) NOT NULL,
        products JSONB DEFAULT '"all"'::jsonb
      );

      CREATE TABLE IF NOT EXISTS status_defs (
        id              INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        critical_from   NUMERIC DEFAULT 0,
        critical_to     NUMERIC DEFAULT 2,
        healthy_from    NUMERIC DEFAULT 2,
        healthy_to      NUMERIC DEFAULT 7,
        excessive_from  NUMERIC DEFAULT 7,
        excessive_to    NUMERIC DEFAULT 9999
      );

      CREATE TABLE IF NOT EXISTS users (
        id       SERIAL PRIMARY KEY,
        login_id VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        name     VARCHAR(255) DEFAULT '',
        role     VARCHAR(50)  DEFAULT 'client'
      );

      CREATE TABLE IF NOT EXISTS stock_update (
        id                    SERIAL PRIMARY KEY,
        site_id               INTEGER NOT NULL,
        product_code          VARCHAR(100) NOT NULL,
        qty                   NUMERIC(12,2) DEFAULT 0,
        preferred_days_override NUMERIC,
        updated_at            TIMESTAMPTZ,
        updated_by            VARCHAR(255),
        UNIQUE (site_id, product_code)
      );

      CREATE TABLE IF NOT EXISTS stock_history (
        id           SERIAL PRIMARY KEY,
        site_id      INTEGER NOT NULL,
        product_code VARCHAR(100) NOT NULL,
        prev_qty     NUMERIC(12,2) DEFAULT 0,
        qty          NUMERIC(12,2) DEFAULT 0,
        updated_at   TIMESTAMPTZ DEFAULT NOW(),
        updated_by   VARCHAR(255)
      );

      CREATE TABLE IF NOT EXISTS stock_inwards (
        id             SERIAL PRIMARY KEY,
        dc_code        VARCHAR(100),
        from_vendor_id INTEGER,
        to_site_id     INTEGER,
        items          JSONB DEFAULT '[]'::jsonb,
        date           TIMESTAMPTZ DEFAULT NOW(),
        status         VARCHAR(50) DEFAULT 'Confirmed'
      );

      CREATE TABLE IF NOT EXISTS product_performance (
        id           SERIAL PRIMARY KEY,
        product_code VARCHAR(100) NOT NULL,
        site_id      INTEGER NOT NULL,
        qty_per_day  NUMERIC(12,4),
        method       VARCHAR(20) DEFAULT 'manual',
        updated_at   TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (product_code, site_id)
      );

      CREATE TABLE IF NOT EXISTS orders (
        id                 VARCHAR(60) PRIMARY KEY,
        site_id            INTEGER,
        placed_by          VARCHAR(100),
        items              JSONB DEFAULT '[]'::jsonb,
        status             VARCHAR(50) DEFAULT 'Pending Approval',
        feedback           TEXT DEFAULT '',
        fulfillment_status VARCHAR(50),
        created_at         TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Seed mandatory single-row tables if empty
    await client.query(`INSERT INTO status_defs (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
    await client.query(`
      INSERT INTO users (login_id, password, name, role)
      VALUES ('admin', 'admin123', 'Admin', 'admin')
      ON CONFLICT (login_id) DO NOTHING
    `);

    console.log("✅ PostgreSQL tables ready");
  } catch (err) {
    console.error("DB init error:", err.message);
    throw err;
  } finally {
    client.release();
  }
}

// ─── Auth ─────────────────────────────────────────────────────────────────
app.post("/api/auth/login", async (req, res) => {
  try {
    const { loginId, password } = req.body || {};
    const r = await pool.query(
      "SELECT id, login_id, name, role FROM users WHERE login_id=$1 AND password=$2",
      [loginId, password]
    );
    if (!r.rows.length) return res.status(401).json({ error: "Invalid login ID or password" });
    const u = r.rows[0];
    res.json({ id: u.id, loginId: u.login_id, name: u.name, role: u.role });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Dashboard ────────────────────────────────────────────────────────────
app.get("/api/dashboard", async (req, res) => {
  try {
    const defs = await getStatusDefs();
    const siteIds = req.query.siteIds
      ? req.query.siteIds.split(",").map(Number).filter(Boolean)
      : [];

    const params = siteIds.length ? [siteIds] : [];
    const filter = siteIds.length ? "WHERE su.site_id = ANY($1::int[])" : "";

    const r = await pool.query(`
      SELECT
        su.site_id,  s.name  AS site_name,
        su.product_code,     p.name  AS product_name,
        p.brand,             p.category,            p.sub_category,
        p.mrp,               su.qty  AS available_qty,
        COALESCE(su.preferred_days_override, s.preferred_days, 5) AS preferred_days,
        pp.qty_per_day,
        CASE WHEN pp.qty_per_day > 0
             THEN ROUND(su.qty / pp.qty_per_day, 2)
             ELSE NULL END AS available_days
      FROM stock_update su
      JOIN sites    s  ON s.id   = su.site_id
      JOIN products p  ON p.code = su.product_code
      LEFT JOIN product_performance pp
             ON pp.product_code = su.product_code AND pp.site_id = su.site_id
      ${filter}
      ORDER BY s.name, p.name
    `, params);

    const rows = r.rows.map(row => {
      const availDays = row.available_days != null ? parseFloat(row.available_days) : null;
      return {
        siteId:       row.site_id,
        siteName:     row.site_name,
        productCode:  row.product_code,
        productName:  row.product_name,
        brand:        row.brand        || "",
        category:     row.category     || "",
        subCategory:  row.sub_category || "",
        mrp:          parseFloat(row.mrp)           || 0,
        availableQty: parseFloat(row.available_qty) || 0,
        preferredDays:parseFloat(row.preferred_days)|| 5,
        qtyPerDay:    row.qty_per_day != null ? parseFloat(row.qty_per_day) : null,
        availableDays: availDays,
        status:       statusFor(availDays, defs),
      };
    });

    const totalStockValue = rows.reduce((s, r) => s + r.availableQty * r.mrp, 0);
    const withDays = rows.filter(r => r.availableDays !== null);
    const avgDays  = withDays.length
      ? +(withDays.reduce((s, r) => s + r.availableDays, 0) / withDays.length).toFixed(1)
      : 0;

    res.json({
      totalStockValue:  +totalStockValue.toFixed(2),
      avgDaysOfStock:   avgDays,
      criticalCount:    rows.filter(r => r.status === "Critical").length,
      healthyCount:     rows.filter(r => r.status === "Healthy").length,
      excessiveCount:   rows.filter(r => r.status === "Excessive").length,
      rows,
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Products ─────────────────────────────────────────────────────────────
app.get("/api/products", async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM products ORDER BY name");
    res.json(r.rows.map(mapProduct));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/products", async (req, res) => {
  try {
    const p = req.body;
    const r = await pool.query(
      `INSERT INTO products
         (code,name,brand,category,sub_category,mrp,case_size,uom,hsn_code,gst,weight,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [ p.code, p.name, p.brand||"", p.category||"", p.subCategory||"",
        Number(p.mrp)||0, Number(p.caseSize)||0, p.uom||"", p.hsnCode||"",
        Number(p.gst)||0, p.weight||"", p.status||"Active" ]
    );
    res.status(201).json(mapProduct(r.rows[0]));
  } catch (e) {
    if (e.code === "23505") {
      const isName = e.constraint && e.constraint.includes("name");
      return res.status(400).json({ error: `Product ${isName ? "Name" : "Code"} already exists` });
    }
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/products/:code", async (req, res) => {
  try {
    const p = req.body;
    const r = await pool.query(
      `UPDATE products
       SET name=$1,brand=$2,category=$3,sub_category=$4,mrp=$5,
           case_size=$6,uom=$7,hsn_code=$8,gst=$9,weight=$10,status=$11
       WHERE code=$12 RETURNING *`,
      [ p.name, p.brand||"", p.category||"", p.subCategory||"",
        Number(p.mrp)||0, Number(p.caseSize)||0, p.uom||"", p.hsnCode||"",
        Number(p.gst)||0, p.weight||"", p.status||"Active", req.params.code ]
    );
    if (!r.rows.length) return res.status(404).json({ error: "Product not found" });
    res.json(mapProduct(r.rows[0]));
  } catch (e) {
    if (e.code === "23505") return res.status(400).json({ error: "Product name already exists" });
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/products/:code", async (req, res) => {
  try {
    await pool.query("DELETE FROM products WHERE code=$1", [req.params.code]);
    res.json({ message: "Deleted" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Legacy endpoint used by Stock Inward template
app.get("/api/products/taxonomy", async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM products WHERE status='Active' ORDER BY name");
    res.json(r.rows.map(p => ({
      code: p.code, sku: p.name, category: p.category,
      subCategory: p.sub_category, mrp: parseFloat(p.mrp), caseSize: parseFloat(p.case_size),
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Sites ────────────────────────────────────────────────────────────────
app.get("/api/sites", async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM sites ORDER BY name");
    res.json(r.rows.map(s => ({ id: s.id, name: s.name, preferredDays: s.preferred_days })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/sites", async (req, res) => {
  try {
    const r = await pool.query(
      "INSERT INTO sites (name, preferred_days) VALUES ($1,$2) RETURNING *",
      [req.body.name, Number(req.body.preferredDays) || 5]
    );
    const s = r.rows[0];
    res.status(201).json({ id: s.id, name: s.name, preferredDays: s.preferred_days });
  } catch (e) {
    if (e.code === "23505") return res.status(400).json({ error: "Site name already exists" });
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/sites/:id", async (req, res) => {
  try {
    const r = await pool.query(
      `UPDATE sites SET
         name           = COALESCE($1, name),
         preferred_days = COALESCE($2, preferred_days)
       WHERE id=$3 RETURNING *`,
      [ req.body.name || null,
        req.body.preferredDays != null ? Number(req.body.preferredDays) : null,
        Number(req.params.id) ]
    );
    if (!r.rows.length) return res.status(404).json({ error: "Site not found" });
    const s = r.rows[0];
    res.json({ id: s.id, name: s.name, preferredDays: s.preferred_days });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/sites/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM sites WHERE id=$1", [Number(req.params.id)]);
    res.json({ message: "Deleted" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Vendors ──────────────────────────────────────────────────────────────
app.get("/api/vendors", async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM vendors ORDER BY name");
    res.json(r.rows.map(v => ({ id: v.id, name: v.name, products: v.products })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/vendors", async (req, res) => {
  try {
    const r = await pool.query(
      "INSERT INTO vendors (name, products) VALUES ($1,$2::jsonb) RETURNING *",
      [req.body.name, JSON.stringify(req.body.products || "all")]
    );
    const v = r.rows[0];
    res.status(201).json({ id: v.id, name: v.name, products: v.products });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/vendors/:id", async (req, res) => {
  try {
    const sets = [], vals = [];
    if (req.body.name     !== undefined) { sets.push(`name=$${sets.length+1}`);     vals.push(req.body.name); }
    if (req.body.products !== undefined) { sets.push(`products=$${sets.length+1}::jsonb`); vals.push(JSON.stringify(req.body.products)); }
    if (!sets.length) return res.status(400).json({ error: "Nothing to update" });
    vals.push(Number(req.params.id));
    const r = await pool.query(`UPDATE vendors SET ${sets.join(",")} WHERE id=$${vals.length} RETURNING *`, vals);
    if (!r.rows.length) return res.status(404).json({ error: "Vendor not found" });
    res.json({ id: r.rows[0].id, name: r.rows[0].name, products: r.rows[0].products });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete("/api/vendors/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM vendors WHERE id=$1", [Number(req.params.id)]);
    res.json({ message: "Deleted" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Status Definitions ───────────────────────────────────────────────────
app.get("/api/status-defs", async (req, res) => {
  try {
    const d = await getStatusDefs();
    res.json({
      critical:  { from: +d.critical_from,  to: +d.critical_to  },
      healthy:   { from: +d.healthy_from,   to: +d.healthy_to   },
      excessive: { from: +d.excessive_from, to: +d.excessive_to },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/status-defs", async (req, res) => {
  try {
    const { critical, healthy, excessive } = req.body;
    await pool.query(
      `UPDATE status_defs SET
         critical_from=$1, critical_to=$2,
         healthy_from=$3,  healthy_to=$4,
         excessive_from=$5,excessive_to=$6
       WHERE id=1`,
      [ critical.from, critical.to, healthy.from, healthy.to, excessive.from, excessive.to ]
    );
    res.json(req.body);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Users ────────────────────────────────────────────────────────────────
app.get("/api/users", async (req, res) => {
  try {
    const r = await pool.query("SELECT id, login_id, name, role FROM users ORDER BY id");
    res.json(r.rows.map(u => ({ id: u.id, loginId: u.login_id, name: u.name, role: u.role })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/users", async (req, res) => {
  try {
    const { loginId, password, name, role } = req.body;
    const r = await pool.query(
      "INSERT INTO users (login_id,password,name,role) VALUES ($1,$2,$3,$4) RETURNING id,login_id,name,role",
      [loginId, password, name||"", role||"client"]
    );
    const u = r.rows[0];
    res.status(201).json({ id: u.id, loginId: u.login_id, name: u.name, role: u.role });
  } catch (e) {
    if (e.code === "23505") return res.status(400).json({ error: "Login ID already exists" });
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/users/:id", async (req, res) => {
  try {
    const sets = [], vals = [];
    const { loginId, password, name, role } = req.body;
    if (loginId  !== undefined) { sets.push(`login_id=$${sets.length+1}`);  vals.push(loginId); }
    if (password !== undefined) { sets.push(`password=$${sets.length+1}`);  vals.push(password); }
    if (name     !== undefined) { sets.push(`name=$${sets.length+1}`);      vals.push(name); }
    if (role     !== undefined) { sets.push(`role=$${sets.length+1}`);      vals.push(role); }
    if (!sets.length) return res.status(400).json({ error: "Nothing to update" });
    vals.push(Number(req.params.id));
    const r = await pool.query(
      `UPDATE users SET ${sets.join(",")} WHERE id=$${vals.length} RETURNING id,login_id,name,role`, vals
    );
    if (!r.rows.length) return res.status(404).json({ error: "User not found" });
    const u = r.rows[0];
    res.json({ id: u.id, loginId: u.login_id, name: u.name, role: u.role });
  } catch (e) {
    if (e.code === "23505") return res.status(400).json({ error: "Login ID already taken" });
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/users/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM users WHERE id=$1", [Number(req.params.id)]);
    res.json({ message: "Deleted" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Stock Update ─────────────────────────────────────────────────────────
app.get("/api/stock-update", async (req, res) => {
  try {
    const siteId = Number(req.query.siteId);
    const r = await pool.query(`
      SELECT su.*,
             p.name AS product_name, p.brand, p.category, p.sub_category,
             p.mrp, p.case_size, p.hsn_code, p.uom,
             COALESCE(su.preferred_days_override, s.preferred_days, 5) AS effective_preferred_days
      FROM stock_update su
      JOIN products p ON p.code = su.product_code
      JOIN sites    s ON s.id   = su.site_id
      WHERE su.site_id = $1
      ORDER BY p.name
    `, [siteId]);

    res.json(r.rows.map(row => ({
      id: row.id, siteId: row.site_id, productCode: row.product_code,
      productName:  row.product_name,   brand: row.brand||"",
      category:     row.category||"",   subCategory: row.sub_category||"",
      mrp:          parseFloat(row.mrp)||0,
      caseSize:     parseFloat(row.case_size)||1,
      hsnCode:      row.hsn_code||"",   uom: row.uom||"",
      qty:          parseFloat(row.qty)||0,
      preferredDays:parseFloat(row.effective_preferred_days)||5,
      preferredDaysOverride: row.preferred_days_override != null ? parseFloat(row.preferred_days_override) : null,
      updatedAt:    row.updated_at,     updatedBy: row.updated_by,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/stock-update", async (req, res) => {
  const client = await pool.connect();
  try {
    const { siteId, productCode, qty, preferredDaysOverride, updatedBy } = req.body;
    const now = new Date().toISOString();

    await client.query("BEGIN");

    // Record previous qty for history
    const prev = await client.query(
      "SELECT qty FROM stock_update WHERE site_id=$1 AND product_code=$2",
      [Number(siteId), productCode]
    );
    const prevQty = prev.rows.length ? parseFloat(prev.rows[0].qty) : 0;

    // Upsert current stock
    await client.query(`
      INSERT INTO stock_update (site_id,product_code,qty,preferred_days_override,updated_at,updated_by)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (site_id,product_code) DO UPDATE
        SET qty=$3, preferred_days_override=$4, updated_at=$5, updated_by=$6
    `, [ Number(siteId), productCode, Number(qty),
         preferredDaysOverride != null ? Number(preferredDaysOverride) : null,
         now, updatedBy || "System" ]);

    // History record
    await client.query(
      "INSERT INTO stock_history (site_id,product_code,prev_qty,qty,updated_at,updated_by) VALUES ($1,$2,$3,$4,$5,$6)",
      [Number(siteId), productCode, prevQty, Number(qty), now, updatedBy || "System"]
    );

    await client.query("COMMIT");
    res.json({ message: "Stock updated" });
  } catch (e) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

app.get("/api/stock-update/history", async (req, res) => {
  try {
    const siteId = Number(req.query.siteId);
    const r = await pool.query(`
      SELECT sh.*, p.name AS product_name
      FROM stock_history sh
      JOIN products p ON p.code = sh.product_code
      WHERE sh.site_id = $1
      ORDER BY sh.updated_at DESC LIMIT 100
    `, [siteId]);
    res.json(r.rows.map(h => ({
      id: h.id, siteId: h.site_id, productCode: h.product_code,
      productName: h.product_name,
      prevQty: parseFloat(h.prev_qty), qty: parseFloat(h.qty),
      updatedAt: h.updated_at, updatedBy: h.updated_by,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Stock Inward ─────────────────────────────────────────────────────────
app.get("/api/stock-inward/history", async (req, res) => {
  try {
    const siteId = req.query.siteId ? Number(req.query.siteId) : null;
    const r = siteId
      ? await pool.query(`
          SELECT si.*, v.name AS vendor_name, s.name AS site_name
          FROM stock_inwards si
          LEFT JOIN vendors v ON v.id = si.from_vendor_id
          LEFT JOIN sites   s ON s.id = si.to_site_id
          WHERE si.to_site_id=$1 ORDER BY si.date DESC`, [siteId])
      : await pool.query(`
          SELECT si.*, v.name AS vendor_name, s.name AS site_name
          FROM stock_inwards si
          LEFT JOIN vendors v ON v.id = si.from_vendor_id
          LEFT JOIN sites   s ON s.id = si.to_site_id
          ORDER BY si.date DESC LIMIT 100`);

    res.json(r.rows.map(row => ({
      id: row.id, dcCode: row.dc_code,
      from: row.from_vendor_id, to: row.to_site_id,
      vendorName: row.vendor_name||"", siteName: row.site_name||"",
      items: row.items || [], date: row.date, status: row.status,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/stock-inward", async (req, res) => {
  const client = await pool.connect();
  try {
    const { dcCode, from, to, items } = req.body;
    const now = new Date().toISOString();

    await client.query("BEGIN");

    const r = await client.query(
      `INSERT INTO stock_inwards (dc_code,from_vendor_id,to_site_id,items,date,status)
       VALUES ($1,$2,$3,$4::jsonb,$5,'Confirmed') RETURNING *`,
      [ dcCode, Number(from)||null, Number(to),
        JSON.stringify(Array.isArray(items) ? items : []), now ]
    );

    // Add quantities to stock_update for destination site
    for (const item of (items || [])) {
      const qty = Number(item.qty) || 0;
      if (!qty || !item.productCode) continue;
      await client.query(`
        INSERT INTO stock_update (site_id,product_code,qty,updated_at,updated_by)
        VALUES ($1,$2,$3,$4,'Stock Inward')
        ON CONFLICT (site_id,product_code)
        DO UPDATE SET qty = stock_update.qty + $3, updated_at=$4, updated_by='Stock Inward'
      `, [Number(to), item.productCode, qty, now]);
    }

    await client.query("COMMIT");
    res.status(201).json({ ...r.rows[0], items: r.rows[0].items || [] });
  } catch (e) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
});

// ─── Product Performance ──────────────────────────────────────────────────
app.get("/api/product-performance", async (req, res) => {
  try {
    const siteId = Number(req.query.siteId);
    const r = await pool.query(`
      SELECT su.product_code,
             p.name AS product_name, p.brand, p.category, p.sub_category, p.mrp,
             pp.qty_per_day, pp.method, pp.updated_at
      FROM stock_update su
      JOIN products p ON p.code = su.product_code
      LEFT JOIN product_performance pp
             ON pp.product_code = su.product_code AND pp.site_id = su.site_id
      WHERE su.site_id = $1
      ORDER BY p.name
    `, [siteId]);

    res.json(r.rows.map(row => ({
      productCode:  row.product_code,
      productName:  row.product_name,  brand:       row.brand||"",
      category:     row.category||"",  subCategory: row.sub_category||"",
      mrp:          parseFloat(row.mrp)||0,
      qtyPerDay:    row.qty_per_day != null ? parseFloat(row.qty_per_day) : null,
      method:       row.method||null,  updatedAt:   row.updated_at||null,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/product-performance", async (req, res) => {
  try {
    const { productCode, siteId, qtyPerDay, method } = req.body;
    await pool.query(`
      INSERT INTO product_performance (product_code,site_id,qty_per_day,method,updated_at)
      VALUES ($1,$2,$3,$4,NOW())
      ON CONFLICT (product_code,site_id)
      DO UPDATE SET qty_per_day=$3, method=$4, updated_at=NOW()
    `, [productCode, Number(siteId), Number(qtyPerDay), method||"manual"]);
    res.json({ message: "Saved" });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/product-performance/auto-calculate", async (req, res) => {
  try {
    const { siteId } = req.body;
    const sid = Number(siteId);

    const products = await pool.query(
      "SELECT DISTINCT product_code FROM stock_history WHERE site_id=$1", [sid]
    );

    const updated = [];
    for (const { product_code } of products.rows) {
      const hist = await pool.query(`
        SELECT qty, updated_at FROM stock_history
        WHERE site_id=$1 AND product_code=$2
        ORDER BY updated_at DESC LIMIT 2
      `, [sid, product_code]);

      if (hist.rows.length < 2) continue;
      const [latest, prev] = hist.rows;
      const daysBetween = (new Date(latest.updated_at) - new Date(prev.updated_at)) / 86400000;
      if (daysBetween < 0.1) continue;
      const consumed = parseFloat(prev.qty) - parseFloat(latest.qty);
      if (consumed <= 0) continue;
      const qtyPerDay = +(consumed / daysBetween).toFixed(4);

      await pool.query(`
        INSERT INTO product_performance (product_code,site_id,qty_per_day,method,updated_at)
        VALUES ($1,$2,$3,'auto',NOW())
        ON CONFLICT (product_code,site_id)
        DO UPDATE SET qty_per_day=$3, method='auto', updated_at=NOW()
      `, [product_code, sid, qtyPerDay]);
      updated.push(product_code);
    }

    res.json({ updated });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Forecast ─────────────────────────────────────────────────────────────
app.get("/api/forecast", async (req, res) => {
  try {
    const siteId = Number(req.query.siteId);
    const defs   = await getStatusDefs();

    const r = await pool.query(`
      SELECT su.product_code,
             p.name AS product_name, p.brand, p.category, p.sub_category,
             p.mrp, p.case_size,    su.qty AS available_qty,
             COALESCE(su.preferred_days_override, s.preferred_days, 5) AS preferred_days,
             pp.qty_per_day,
             CASE WHEN pp.qty_per_day > 0
                  THEN ROUND(su.qty / pp.qty_per_day, 2)
                  ELSE NULL END AS available_days
      FROM stock_update su
      JOIN sites    s  ON s.id   = su.site_id
      JOIN products p  ON p.code = su.product_code
      LEFT JOIN product_performance pp
             ON pp.product_code = su.product_code AND pp.site_id = su.site_id
      WHERE su.site_id = $1
      ORDER BY available_days ASC NULLS LAST
    `, [siteId]);

    res.json(r.rows.map(row => {
      const availDays   = row.available_days != null ? parseFloat(row.available_days) : null;
      const status      = statusFor(availDays, defs);
      const qtyPerDay   = row.qty_per_day ? parseFloat(row.qty_per_day) : 0;
      const prefDays    = parseFloat(row.preferred_days) || 5;
      const caseSize    = Math.max(1, parseFloat(row.case_size) || 1);
      const availQty    = parseFloat(row.available_qty) || 0;

      let orderQty = 0;
      if (status === "Critical" && qtyPerDay > 0) {
        const deficit = prefDays * qtyPerDay - availQty;
        if (deficit > 0) orderQty = Math.ceil(deficit / caseSize) * caseSize;
      }

      return {
        productCode:  row.product_code,  productName: row.product_name,
        brand:        row.brand||"",     category:    row.category||"",
        subCategory:  row.sub_category||"",
        mrp:          parseFloat(row.mrp)||0,
        caseSize,     availableQty: availQty,
        preferredDays: prefDays,   availableDays: availDays,
        status,       orderQty,
      };
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Orders ───────────────────────────────────────────────────────────────
app.get("/api/orders", async (req, res) => {
  try {
    const siteId = req.query.siteId ? Number(req.query.siteId) : null;
    const r = siteId
      ? await pool.query("SELECT * FROM orders WHERE site_id=$1 ORDER BY created_at DESC", [siteId])
      : await pool.query("SELECT * FROM orders ORDER BY created_at DESC");

    res.json(r.rows.map(o => ({
      id: o.id, siteId: o.site_id, placedBy: o.placed_by,
      items: o.items||[], status: o.status,
      feedback: o.feedback, fulfillmentStatus: o.fulfillment_status,
      createdAt: o.created_at,
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/orders", async (req, res) => {
  try {
    const { id, siteId, placedBy, items, status } = req.body;
    const orderId = id || nextOrderId();
    const r = await pool.query(
      "INSERT INTO orders (id,site_id,placed_by,items,status) VALUES ($1,$2,$3,$4::jsonb,$5) RETURNING *",
      [ orderId, Number(siteId), placedBy||"",
        JSON.stringify(items||[]), status||"Pending Approval" ]
    );
    const o = r.rows[0];
    res.status(201).json({ id:o.id, siteId:o.site_id, placedBy:o.placed_by, items:o.items||[], status:o.status, createdAt:o.created_at });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/orders/:id", async (req, res) => {
  try {
    const sets = [], vals = [];
    const { status, feedback, fulfillmentStatus } = req.body;
    if (status            !== undefined) { sets.push(`status=$${sets.length+1}`);             vals.push(status); }
    if (feedback          !== undefined) { sets.push(`feedback=$${sets.length+1}`);           vals.push(feedback); }
    if (fulfillmentStatus !== undefined) { sets.push(`fulfillment_status=$${sets.length+1}`); vals.push(fulfillmentStatus); }
    if (!sets.length) return res.status(400).json({ error: "Nothing to update" });
    vals.push(req.params.id);
    const r = await pool.query(`UPDATE orders SET ${sets.join(",")} WHERE id=$${vals.length} RETURNING *`, vals);
    if (!r.rows.length) return res.status(404).json({ error: "Order not found" });
    const o = r.rows[0];
    res.json({ id:o.id, siteId:o.site_id, placedBy:o.placed_by, items:o.items||[], status:o.status, feedback:o.feedback, fulfillmentStatus:o.fulfillment_status, createdAt:o.created_at });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Start ────────────────────────────────────────────────────────────────
initDB().then(() => {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => console.log(`✅ Pantry API running on port ${PORT}`));
}).catch(err => {
  console.error("❌ Failed to start — DB error:", err.message);
  process.exit(1);
});
