const express = require("express");
const cors    = require("cors");
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

// ─── Helpers ──────────────────────────────────────────────────────────────
const statusFor = (days, defs) => {
  if (days === null || days === undefined) return "Unknown";
  const d = Number(days);
  if (d <= Number(defs.critical_to))    return "Critical";
  if (d >= Number(defs.surplus_from || defs.excessive_from)) return "Surplus";
  return "Optimal";
};

// Get status defs: site-specific first, then global fallback
const getStatusDefs = async (siteId) => {
  if (siteId) {
    const r = await pool.query("SELECT * FROM site_status_defs WHERE site_id=$1", [siteId]);
    if (r.rows.length) return r.rows[0];
  }
  const r = await pool.query("SELECT * FROM status_defs WHERE id=1");
  const d = r.rows[0] || {};
  return { critical_from:0, critical_to:2, optimal_from:2, optimal_to:7, surplus_from:7, surplus_to:9999, ...d };
};

const mapProduct = (p) => ({
  id:p.id, code:p.code, name:p.name, brand:p.brand||"",
  category:p.category||"", subCategory:p.sub_category||"",
  mrp:parseFloat(p.mrp)||0, caseSize:parseFloat(p.case_size)||0,
  uom:p.uom||"", hsnCode:p.hsn_code||"",
  gst:parseFloat(p.gst)||0, weight:p.weight||"", status:p.status||"Active",
});

const nextOrderId = () => `ORD-${Date.now().toString(36).toUpperCase()}`;

// ─── DB Init ──────────────────────────────────────────────────────────────
async function initDB() {
  const c = await pool.connect();
  try {
    await c.query(`
      CREATE TABLE IF NOT EXISTS sites (
        id             SERIAL PRIMARY KEY,
        name           VARCHAR(255) UNIQUE NOT NULL,
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
        products JSONB DEFAULT '"all"'::jsonb,
        sites    JSONB DEFAULT '"all"'::jsonb
      );
      CREATE TABLE IF NOT EXISTS status_defs (
        id             INTEGER PRIMARY KEY DEFAULT 1 CHECK (id=1),
        critical_from  NUMERIC DEFAULT 0,
        critical_to    NUMERIC DEFAULT 2,
        optimal_from   NUMERIC DEFAULT 2,
        optimal_to     NUMERIC DEFAULT 7,
        surplus_from   NUMERIC DEFAULT 7,
        surplus_to     NUMERIC DEFAULT 9999
      );
      CREATE TABLE IF NOT EXISTS site_status_defs (
        site_id        INTEGER PRIMARY KEY,
        critical_from  NUMERIC DEFAULT 0,
        critical_to    NUMERIC DEFAULT 2,
        optimal_from   NUMERIC DEFAULT 2,
        optimal_to     NUMERIC DEFAULT 7,
        surplus_from   NUMERIC DEFAULT 7,
        surplus_to     NUMERIC DEFAULT 9999
      );
      CREATE TABLE IF NOT EXISTS users (
        id       SERIAL PRIMARY KEY,
        login_id VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        name     VARCHAR(255) DEFAULT '',
        role     VARCHAR(50)  DEFAULT 'client',
        sites    JSONB DEFAULT '"all"'::jsonb
      );
      CREATE TABLE IF NOT EXISTS stock_update (
        id                      SERIAL PRIMARY KEY,
        site_id                 INTEGER NOT NULL,
        product_code            VARCHAR(100) NOT NULL,
        qty                     NUMERIC(12,2) DEFAULT 0,
        preferred_days_override NUMERIC,
        updated_at              TIMESTAMPTZ,
        updated_by              VARCHAR(255),
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
        id                   VARCHAR(60) PRIMARY KEY,
        site_id              INTEGER,
        placed_by            VARCHAR(100),
        approved_by          VARCHAR(100),
        items                JSONB DEFAULT '[]'::jsonb,
        status               VARCHAR(50) DEFAULT 'Pending Approval',
        feedback             TEXT DEFAULT '',
        fulfillment_status   VARCHAR(50),
        fulfilled_qty        NUMERIC(12,2),
        pending_qty          NUMERIC(12,2),
        fulfillment_remarks  TEXT DEFAULT '',
        created_at           TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Safe column additions for existing deployments
    const alters = [
      `ALTER TABLE vendors ADD COLUMN IF NOT EXISTS sites JSONB DEFAULT '"all"'::jsonb`,
      `ALTER TABLE users   ADD COLUMN IF NOT EXISTS sites JSONB DEFAULT '"all"'::jsonb`,
      `ALTER TABLE orders  ADD COLUMN IF NOT EXISTS approved_by VARCHAR(100)`,
      `ALTER TABLE orders  ADD COLUMN IF NOT EXISTS fulfilled_qty NUMERIC(12,2)`,
      `ALTER TABLE orders  ADD COLUMN IF NOT EXISTS pending_qty NUMERIC(12,2)`,
      `ALTER TABLE orders  ADD COLUMN IF NOT EXISTS fulfillment_remarks TEXT DEFAULT ''`,
      // rename old column names if they exist
      `DO $$ BEGIN
         IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='status_defs' AND column_name='healthy_from') THEN
           ALTER TABLE status_defs RENAME COLUMN healthy_from   TO optimal_from;
           ALTER TABLE status_defs RENAME COLUMN healthy_to     TO optimal_to;
           ALTER TABLE status_defs RENAME COLUMN excessive_from TO surplus_from;
           ALTER TABLE status_defs RENAME COLUMN excessive_to   TO surplus_to;
         END IF;
       END $$`,
    ];
    for (const sql of alters) {
      await c.query(sql).catch(() => {});
    }

    await c.query(`INSERT INTO status_defs (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
    await c.query(`
      INSERT INTO users (login_id,password,name,role)
      VALUES ('admin','admin123','Admin','admin')
      ON CONFLICT (login_id) DO NOTHING
    `);
    console.log("✅ PostgreSQL tables ready");
  } catch (e) {
    console.error("DB init error:", e.message); throw e;
  } finally { c.release(); }
}

// ─── Auth ─────────────────────────────────────────────────────────────────
app.post("/api/auth/login", async (req, res) => {
  try {
    const { loginId, password } = req.body || {};
    const r = await pool.query(
      "SELECT id,login_id,name,role,sites FROM users WHERE login_id=$1 AND password=$2",
      [loginId, password]
    );
    if (!r.rows.length) return res.status(401).json({ error:"Invalid login ID or password" });
    const u = r.rows[0];
    res.json({ id:u.id, loginId:u.login_id, name:u.name, role:u.role, sites:u.sites });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ─── Dashboard ────────────────────────────────────────────────────────────
app.get("/api/dashboard", async (req, res) => {
  try {
    const siteIds = req.query.siteIds
      ? req.query.siteIds.split(",").map(Number).filter(Boolean)
      : [];
    const defs = await getStatusDefs(siteIds.length === 1 ? siteIds[0] : null);
    const params = siteIds.length ? [siteIds] : [];
    const filter = siteIds.length ? "WHERE su.site_id = ANY($1::int[])" : "";

    const r = await pool.query(`
      SELECT su.site_id, s.name AS site_name, su.product_code,
             p.name AS product_name, p.brand, p.category, p.sub_category, p.mrp,
             su.qty AS available_qty,
             COALESCE(su.preferred_days_override, s.preferred_days, 5) AS preferred_days,
             pp.qty_per_day,
             CASE WHEN pp.qty_per_day > 0
                  THEN ROUND(su.qty / pp.qty_per_day, 2) ELSE NULL END AS available_days
      FROM stock_update su
      JOIN sites    s ON s.id   = su.site_id
      JOIN products p ON p.code = su.product_code
      LEFT JOIN product_performance pp ON pp.product_code=su.product_code AND pp.site_id=su.site_id
      ${filter} ORDER BY s.name, p.name
    `, params);

    const rows = r.rows.map(row => {
      const availDays = row.available_days != null ? parseFloat(row.available_days) : null;
      return {
        siteId:row.site_id, siteName:row.site_name,
        productCode:row.product_code, productName:row.product_name,
        brand:row.brand||"", category:row.category||"", subCategory:row.sub_category||"",
        mrp:parseFloat(row.mrp)||0, availableQty:parseFloat(row.available_qty)||0,
        preferredDays:parseFloat(row.preferred_days)||5,
        qtyPerDay:row.qty_per_day!=null?parseFloat(row.qty_per_day):null,
        availableDays:availDays, status:statusFor(availDays, defs),
      };
    });

    const totalStockValue = rows.reduce((s,r) => s + r.availableQty*r.mrp, 0);
    const withDays = rows.filter(r => r.availableDays!==null);
    const avgDays = withDays.length ? +(withDays.reduce((s,r) => s+r.availableDays,0)/withDays.length).toFixed(1) : 0;
    res.json({
      totalStockValue:+totalStockValue.toFixed(2), avgDaysOfStock:avgDays,
      criticalCount:rows.filter(r=>r.status==="Critical").length,
      optimalCount:rows.filter(r=>r.status==="Optimal").length,
      surplusCount:rows.filter(r=>r.status==="Surplus").length,
      rows,
    });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ─── Products CRUD ────────────────────────────────────────────────────────
app.get("/api/products", async (req, res) => {
  try { res.json((await pool.query("SELECT * FROM products ORDER BY name")).rows.map(mapProduct)); }
  catch(e) { res.status(500).json({ error:e.message }); }
});

app.post("/api/products", async (req, res) => {
  try {
    const p = req.body;
    const r = await pool.query(
      `INSERT INTO products (code,name,brand,category,sub_category,mrp,case_size,uom,hsn_code,gst,weight,status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [p.code,p.name,p.brand||"",p.category||"",p.subCategory||"",
       Number(p.mrp)||0,Number(p.caseSize)||0,p.uom||"",p.hsnCode||"",
       Number(p.gst)||0,p.weight||"",p.status||"Active"]
    );
    res.status(201).json(mapProduct(r.rows[0]));
  } catch(e) {
    if (e.code==="23505") return res.status(400).json({ error:`Product ${e.constraint?.includes("name")?"Name":"Code"} already exists` });
    res.status(500).json({ error:e.message });
  }
});

app.put("/api/products/:code", async (req, res) => {
  try {
    const p = req.body;
    const r = await pool.query(
      `UPDATE products SET name=$1,brand=$2,category=$3,sub_category=$4,mrp=$5,
       case_size=$6,uom=$7,hsn_code=$8,gst=$9,weight=$10,status=$11 WHERE code=$12 RETURNING *`,
      [p.name,p.brand||"",p.category||"",p.subCategory||"",Number(p.mrp)||0,
       Number(p.caseSize)||0,p.uom||"",p.hsnCode||"",Number(p.gst)||0,p.weight||"",p.status||"Active",req.params.code]
    );
    if (!r.rows.length) return res.status(404).json({ error:"Not found" });
    res.json(mapProduct(r.rows[0]));
  } catch(e) {
    if (e.code==="23505") return res.status(400).json({ error:"Product name already exists" });
    res.status(500).json({ error:e.message });
  }
});

app.delete("/api/products/:code", async (req, res) => {
  try { await pool.query("DELETE FROM products WHERE code=$1",[req.params.code]); res.json({ message:"Deleted" }); }
  catch(e) { res.status(500).json({ error:e.message }); }
});

app.get("/api/products/taxonomy", async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM products WHERE status='Active' ORDER BY name");
    res.json(r.rows.map(p=>({ code:p.code,sku:p.name,category:p.category,subCategory:p.sub_category,mrp:parseFloat(p.mrp),caseSize:parseFloat(p.case_size) })));
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ─── Sites CRUD ───────────────────────────────────────────────────────────
app.get("/api/sites", async (req, res) => {
  try { res.json((await pool.query("SELECT * FROM sites ORDER BY name")).rows.map(s=>({ id:s.id,name:s.name,preferredDays:s.preferred_days }))); }
  catch(e) { res.status(500).json({ error:e.message }); }
});

app.post("/api/sites", async (req, res) => {
  try {
    const r = await pool.query("INSERT INTO sites (name,preferred_days) VALUES ($1,$2) RETURNING *",[req.body.name,Number(req.body.preferredDays)||5]);
    const s=r.rows[0]; res.status(201).json({ id:s.id,name:s.name,preferredDays:s.preferred_days });
  } catch(e) {
    if (e.code==="23505") return res.status(400).json({ error:"Site name already exists" });
    res.status(500).json({ error:e.message });
  }
});

app.put("/api/sites/:id", async (req, res) => {
  try {
    const r = await pool.query(
      "UPDATE sites SET name=COALESCE($1,name), preferred_days=COALESCE($2,preferred_days) WHERE id=$3 RETURNING *",
      [req.body.name||null, req.body.preferredDays!=null?Number(req.body.preferredDays):null, Number(req.params.id)]
    );
    if (!r.rows.length) return res.status(404).json({ error:"Not found" });
    const s=r.rows[0]; res.json({ id:s.id,name:s.name,preferredDays:s.preferred_days });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.delete("/api/sites/:id", async (req, res) => {
  try { await pool.query("DELETE FROM sites WHERE id=$1",[Number(req.params.id)]); res.json({ message:"Deleted" }); }
  catch(e) { res.status(500).json({ error:e.message }); }
});

// ─── Vendors CRUD ─────────────────────────────────────────────────────────
app.get("/api/vendors", async (req, res) => {
  try { res.json((await pool.query("SELECT * FROM vendors ORDER BY name")).rows.map(v=>({ id:v.id,name:v.name,products:v.products,sites:v.sites }))); }
  catch(e) { res.status(500).json({ error:e.message }); }
});

app.post("/api/vendors", async (req, res) => {
  try {
    const r = await pool.query(
      "INSERT INTO vendors (name,products,sites) VALUES ($1,$2::jsonb,$3::jsonb) RETURNING *",
      [req.body.name, JSON.stringify(req.body.products||"all"), JSON.stringify(req.body.sites||"all")]
    );
    const v=r.rows[0]; res.status(201).json({ id:v.id,name:v.name,products:v.products,sites:v.sites });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.put("/api/vendors/:id", async (req, res) => {
  try {
    const sets=[],vals=[];
    if (req.body.name!==undefined)     { sets.push(`name=$${sets.length+1}`);           vals.push(req.body.name); }
    if (req.body.products!==undefined) { sets.push(`products=$${sets.length+1}::jsonb`);vals.push(JSON.stringify(req.body.products)); }
    if (req.body.sites!==undefined)    { sets.push(`sites=$${sets.length+1}::jsonb`);   vals.push(JSON.stringify(req.body.sites)); }
    if (!sets.length) return res.status(400).json({ error:"Nothing to update" });
    vals.push(Number(req.params.id));
    const r = await pool.query(`UPDATE vendors SET ${sets.join(",")} WHERE id=$${vals.length} RETURNING *`,vals);
    if (!r.rows.length) return res.status(404).json({ error:"Not found" });
    const v=r.rows[0]; res.json({ id:v.id,name:v.name,products:v.products,sites:v.sites });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.delete("/api/vendors/:id", async (req, res) => {
  try { await pool.query("DELETE FROM vendors WHERE id=$1",[Number(req.params.id)]); res.json({ message:"Deleted" }); }
  catch(e) { res.status(500).json({ error:e.message }); }
});

// ─── Status Definitions (global + site-specific) ──────────────────────────
app.get("/api/status-defs", async (req, res) => {
  try {
    const siteId = req.query.siteId ? Number(req.query.siteId) : null;
    const d = await getStatusDefs(siteId);
    res.json({
      siteId: d.site_id||null, isGlobal:!d.site_id,
      critical: { from:+d.critical_from, to:+d.critical_to },
      optimal:  { from:+(d.optimal_from||d.healthy_from||2), to:+(d.optimal_to||d.healthy_to||7) },
      surplus:  { from:+(d.surplus_from||d.excessive_from||7), to:+(d.surplus_to||d.excessive_to||9999) },
    });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.put("/api/status-defs", async (req, res) => {
  try {
    const { siteId, critical, optimal, surplus } = req.body;
    if (siteId) {
      await pool.query(`
        INSERT INTO site_status_defs (site_id,critical_from,critical_to,optimal_from,optimal_to,surplus_from,surplus_to)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (site_id) DO UPDATE SET
          critical_from=$2,critical_to=$3,optimal_from=$4,optimal_to=$5,surplus_from=$6,surplus_to=$7
      `, [siteId,critical.from,critical.to,optimal.from,optimal.to,surplus.from,surplus.to]);
    } else {
      await pool.query(`
        UPDATE status_defs SET critical_from=$1,critical_to=$2,optimal_from=$3,optimal_to=$4,surplus_from=$5,surplus_to=$6 WHERE id=1
      `, [critical.from,critical.to,optimal.from,optimal.to,surplus.from,surplus.to]);
    }
    res.json(req.body);
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.delete("/api/status-defs/:siteId", async (req, res) => {
  try { await pool.query("DELETE FROM site_status_defs WHERE site_id=$1",[Number(req.params.siteId)]); res.json({ message:"Deleted, reverted to global" }); }
  catch(e) { res.status(500).json({ error:e.message }); }
});

// ─── Users CRUD ───────────────────────────────────────────────────────────
app.get("/api/users", async (req, res) => {
  try {
    const r = await pool.query("SELECT id,login_id,name,role,sites FROM users ORDER BY id");
    res.json(r.rows.map(u=>({ id:u.id,loginId:u.login_id,name:u.name,role:u.role,sites:u.sites })));
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.post("/api/users", async (req, res) => {
  try {
    const { loginId,password,name,role,sites } = req.body;
    const r = await pool.query(
      "INSERT INTO users (login_id,password,name,role,sites) VALUES ($1,$2,$3,$4,$5::jsonb) RETURNING id,login_id,name,role,sites",
      [loginId,password,name||"",role||"client",JSON.stringify(sites||"all")]
    );
    const u=r.rows[0]; res.status(201).json({ id:u.id,loginId:u.login_id,name:u.name,role:u.role,sites:u.sites });
  } catch(e) {
    if (e.code==="23505") return res.status(400).json({ error:"Login ID already exists" });
    res.status(500).json({ error:e.message });
  }
});

app.put("/api/users/:id", async (req, res) => {
  try {
    const sets=[],vals=[];
    const { loginId,password,name,role,sites } = req.body;
    if (loginId!==undefined)  { sets.push(`login_id=$${sets.length+1}`);       vals.push(loginId); }
    if (password!==undefined) { sets.push(`password=$${sets.length+1}`);       vals.push(password); }
    if (name!==undefined)     { sets.push(`name=$${sets.length+1}`);           vals.push(name); }
    if (role!==undefined)     { sets.push(`role=$${sets.length+1}`);           vals.push(role); }
    if (sites!==undefined)    { sets.push(`sites=$${sets.length+1}::jsonb`);   vals.push(JSON.stringify(sites)); }
    if (!sets.length) return res.status(400).json({ error:"Nothing to update" });
    vals.push(Number(req.params.id));
    const r = await pool.query(`UPDATE users SET ${sets.join(",")} WHERE id=$${vals.length} RETURNING id,login_id,name,role,sites`,vals);
    if (!r.rows.length) return res.status(404).json({ error:"Not found" });
    const u=r.rows[0]; res.json({ id:u.id,loginId:u.login_id,name:u.name,role:u.role,sites:u.sites });
  } catch(e) {
    if (e.code==="23505") return res.status(400).json({ error:"Login ID already taken" });
    res.status(500).json({ error:e.message });
  }
});

app.delete("/api/users/:id", async (req, res) => {
  try {
    const r = await pool.query("SELECT login_id FROM users WHERE id=$1",[Number(req.params.id)]);
    if (r.rows[0]?.login_id==="admin") return res.status(400).json({ error:"Cannot delete the admin account" });
    await pool.query("DELETE FROM users WHERE id=$1",[Number(req.params.id)]);
    res.json({ message:"Deleted" });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ─── Stock Update ─────────────────────────────────────────────────────────
app.get("/api/stock-update", async (req, res) => {
  try {
    const siteId = Number(req.query.siteId);
    const r = await pool.query(`
      SELECT su.*, p.name AS product_name, p.brand, p.category, p.sub_category,
             p.mrp, p.case_size, p.hsn_code, p.uom,
             COALESCE(su.preferred_days_override, s.preferred_days, 5) AS effective_preferred_days
      FROM stock_update su
      JOIN products p ON p.code=su.product_code
      JOIN sites    s ON s.id  =su.site_id
      WHERE su.site_id=$1 ORDER BY p.name
    `, [siteId]);
    res.json(r.rows.map(row=>({
      id:row.id, siteId:row.site_id, productCode:row.product_code,
      productName:row.product_name, brand:row.brand||"",
      category:row.category||"", subCategory:row.sub_category||"",
      mrp:parseFloat(row.mrp)||0, caseSize:parseFloat(row.case_size)||1,
      hsnCode:row.hsn_code||"", uom:row.uom||"",
      qty:parseFloat(row.qty)||0,
      preferredDays:parseFloat(row.effective_preferred_days)||5,
      preferredDaysOverride:row.preferred_days_override!=null?parseFloat(row.preferred_days_override):null,
      updatedAt:row.updated_at, updatedBy:row.updated_by,
    })));
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.post("/api/stock-update", async (req, res) => {
  const c = await pool.connect();
  try {
    const { siteId,productCode,qty,preferredDaysOverride,updatedBy } = req.body;
    const now = new Date().toISOString();
    await c.query("BEGIN");
    const prev = await c.query("SELECT qty FROM stock_update WHERE site_id=$1 AND product_code=$2",[Number(siteId),productCode]);
    const prevQty = prev.rows.length ? parseFloat(prev.rows[0].qty) : 0;
    await c.query(`
      INSERT INTO stock_update (site_id,product_code,qty,preferred_days_override,updated_at,updated_by)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (site_id,product_code) DO UPDATE
        SET qty=$3,preferred_days_override=$4,updated_at=$5,updated_by=$6
    `, [Number(siteId),productCode,Number(qty),preferredDaysOverride!=null?Number(preferredDaysOverride):null,now,updatedBy||"System"]);
    await c.query("INSERT INTO stock_history (site_id,product_code,prev_qty,qty,updated_at,updated_by) VALUES ($1,$2,$3,$4,$5,$6)",
      [Number(siteId),productCode,prevQty,Number(qty),now,updatedBy||"System"]);
    await c.query("COMMIT");
    res.json({ message:"Stock updated" });
  } catch(e) { await c.query("ROLLBACK"); res.status(500).json({ error:e.message }); }
  finally { c.release(); }
});

app.get("/api/stock-update/history", async (req, res) => {
  try {
    const siteId = Number(req.query.siteId);
    const r = await pool.query(`
      SELECT sh.*, p.name AS product_name FROM stock_history sh
      JOIN products p ON p.code=sh.product_code
      WHERE sh.site_id=$1 ORDER BY sh.updated_at DESC LIMIT 100
    `, [siteId]);
    res.json(r.rows.map(h=>({ id:h.id,siteId:h.site_id,productCode:h.product_code,productName:h.product_name,prevQty:parseFloat(h.prev_qty),qty:parseFloat(h.qty),updatedAt:h.updated_at,updatedBy:h.updated_by })));
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ─── Stock Inward ─────────────────────────────────────────────────────────
app.get("/api/stock-inward/history", async (req, res) => {
  try {
    const siteId = req.query.siteId ? Number(req.query.siteId) : null;
    const r = siteId
      ? await pool.query(`SELECT si.*,v.name AS vendor_name,s.name AS site_name FROM stock_inwards si LEFT JOIN vendors v ON v.id=si.from_vendor_id LEFT JOIN sites s ON s.id=si.to_site_id WHERE si.to_site_id=$1 ORDER BY si.date DESC`,[siteId])
      : await pool.query(`SELECT si.*,v.name AS vendor_name,s.name AS site_name FROM stock_inwards si LEFT JOIN vendors v ON v.id=si.from_vendor_id LEFT JOIN sites s ON s.id=si.to_site_id ORDER BY si.date DESC LIMIT 100`);
    res.json(r.rows.map(row=>({ id:row.id,dcCode:row.dc_code,from:row.from_vendor_id,to:row.to_site_id,vendorName:row.vendor_name||"",siteName:row.site_name||"",items:row.items||[],date:row.date,status:row.status })));
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.post("/api/stock-inward", async (req, res) => {
  const c = await pool.connect();
  try {
    const { dcCode,from,to,items } = req.body;
    const now = new Date().toISOString();
    await c.query("BEGIN");
    const r = await c.query(
      "INSERT INTO stock_inwards (dc_code,from_vendor_id,to_site_id,items,date,status) VALUES ($1,$2,$3,$4::jsonb,$5,'Confirmed') RETURNING *",
      [dcCode,Number(from)||null,Number(to),JSON.stringify(Array.isArray(items)?items:[]),now]
    );
    for (const item of (items||[])) {
      const qty = Number(item.qty)||0;
      if (!qty||!item.productCode) continue;
      await c.query(`
        INSERT INTO stock_update (site_id,product_code,qty,updated_at,updated_by) VALUES ($1,$2,$3,$4,'Stock Inward')
        ON CONFLICT (site_id,product_code) DO UPDATE SET qty=stock_update.qty+$3,updated_at=$4,updated_by='Stock Inward'
      `, [Number(to),item.productCode,qty,now]);
    }
    await c.query("COMMIT");
    res.status(201).json({ ...r.rows[0],items:r.rows[0].items||[] });
  } catch(e) { await c.query("ROLLBACK"); res.status(500).json({ error:e.message }); }
  finally { c.release(); }
});

app.put("/api/stock-inward/:id", async (req, res) => {
  try {
    const { dcCode,from,to,items,status } = req.body;
    const sets=[],vals=[];
    if (dcCode!==undefined) { sets.push(`dc_code=$${sets.length+1}`); vals.push(dcCode); }
    if (status!==undefined) { sets.push(`status=$${sets.length+1}`); vals.push(status); }
    if (items!==undefined)  { sets.push(`items=$${sets.length+1}::jsonb`); vals.push(JSON.stringify(items)); }
    if (!sets.length) return res.status(400).json({ error:"Nothing to update" });
    vals.push(Number(req.params.id));
    const r = await pool.query(`UPDATE stock_inwards SET ${sets.join(",")} WHERE id=$${vals.length} RETURNING *`,vals);
    if (!r.rows.length) return res.status(404).json({ error:"Not found" });
    res.json(r.rows[0]);
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.delete("/api/stock-inward/:id", async (req, res) => {
  try { await pool.query("DELETE FROM stock_inwards WHERE id=$1",[Number(req.params.id)]); res.json({ message:"Deleted" }); }
  catch(e) { res.status(500).json({ error:e.message }); }
});

// ─── Product Performance ──────────────────────────────────────────────────
app.get("/api/product-performance", async (req, res) => {
  try {
    const siteId = Number(req.query.siteId);
    const r = await pool.query(`
      SELECT su.product_code, p.name AS product_name, p.brand, p.category, p.sub_category, p.mrp,
             pp.qty_per_day, pp.method, pp.updated_at
      FROM stock_update su
      JOIN products p ON p.code=su.product_code
      LEFT JOIN product_performance pp ON pp.product_code=su.product_code AND pp.site_id=su.site_id
      WHERE su.site_id=$1 ORDER BY p.name
    `, [siteId]);
    res.json(r.rows.map(row=>({ productCode:row.product_code,productName:row.product_name,brand:row.brand||"",category:row.category||"",subCategory:row.sub_category||"",mrp:parseFloat(row.mrp)||0,qtyPerDay:row.qty_per_day!=null?parseFloat(row.qty_per_day):null,method:row.method||null,updatedAt:row.updated_at||null })));
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.post("/api/product-performance", async (req, res) => {
  try {
    const { productCode,siteId,qtyPerDay,method } = req.body;
    await pool.query(`
      INSERT INTO product_performance (product_code,site_id,qty_per_day,method,updated_at) VALUES ($1,$2,$3,$4,NOW())
      ON CONFLICT (product_code,site_id) DO UPDATE SET qty_per_day=$3,method=$4,updated_at=NOW()
    `, [productCode,Number(siteId),Number(qtyPerDay),method||"manual"]);
    res.json({ message:"Saved" });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.post("/api/product-performance/auto-calculate", async (req, res) => {
  try {
    const { siteId } = req.body;
    const products = await pool.query("SELECT DISTINCT product_code FROM stock_history WHERE site_id=$1",[Number(siteId)]);
    const updated = [];
    for (const { product_code } of products.rows) {
      const hist = await pool.query("SELECT qty,updated_at FROM stock_history WHERE site_id=$1 AND product_code=$2 ORDER BY updated_at DESC LIMIT 2",[Number(siteId),product_code]);
      if (hist.rows.length<2) continue;
      const [latest,prev] = hist.rows;
      const daysBetween = (new Date(latest.updated_at)-new Date(prev.updated_at))/86400000;
      if (daysBetween<0.1) continue;
      const consumed = parseFloat(prev.qty)-parseFloat(latest.qty);
      if (consumed<=0) continue;
      const qtyPerDay = +(consumed/daysBetween).toFixed(4);
      await pool.query(`INSERT INTO product_performance (product_code,site_id,qty_per_day,method,updated_at) VALUES ($1,$2,$3,'auto',NOW()) ON CONFLICT (product_code,site_id) DO UPDATE SET qty_per_day=$3,method='auto',updated_at=NOW()`,[product_code,Number(siteId),qtyPerDay]);
      updated.push(product_code);
    }
    res.json({ updated });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ─── Forecast ─────────────────────────────────────────────────────────────
app.get("/api/forecast", async (req, res) => {
  try {
    const siteId = Number(req.query.siteId);
    const defs = await getStatusDefs(siteId);
    const r = await pool.query(`
      SELECT su.product_code, p.name AS product_name, p.brand, p.category, p.sub_category,
             p.mrp, p.case_size, su.qty AS available_qty,
             COALESCE(su.preferred_days_override, s.preferred_days, 5) AS preferred_days,
             pp.qty_per_day,
             CASE WHEN pp.qty_per_day>0 THEN ROUND(su.qty/pp.qty_per_day,2) ELSE NULL END AS available_days
      FROM stock_update su
      JOIN sites    s ON s.id  =su.site_id
      JOIN products p ON p.code=su.product_code
      LEFT JOIN product_performance pp ON pp.product_code=su.product_code AND pp.site_id=su.site_id
      WHERE su.site_id=$1 ORDER BY available_days ASC NULLS LAST
    `, [siteId]);
    res.json(r.rows.map(row => {
      const availDays = row.available_days!=null?parseFloat(row.available_days):null;
      const status    = statusFor(availDays,defs);
      const qtyPerDay = row.qty_per_day?parseFloat(row.qty_per_day):0;
      const prefDays  = parseFloat(row.preferred_days)||5;
      const caseSize  = Math.max(1,parseFloat(row.case_size)||1);
      const availQty  = parseFloat(row.available_qty)||0;
      let orderQty = 0;
      if (status==="Critical"&&qtyPerDay>0) {
        const deficit = prefDays*qtyPerDay-availQty;
        if (deficit>0) orderQty = Math.ceil(deficit/caseSize)*caseSize;
      }
      return { productCode:row.product_code,productName:row.product_name,brand:row.brand||"",category:row.category||"",subCategory:row.sub_category||"",mrp:parseFloat(row.mrp)||0,caseSize,availableQty:availQty,preferredDays:prefDays,availableDays:availDays,status,orderQty };
    }));
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ─── Orders ───────────────────────────────────────────────────────────────
app.get("/api/orders", async (req, res) => {
  try {
    const siteId = req.query.siteId?Number(req.query.siteId):null;
    const r = siteId
      ? await pool.query("SELECT o.*,s.name AS site_name FROM orders o LEFT JOIN sites s ON s.id=o.site_id WHERE o.site_id=$1 ORDER BY o.created_at DESC",[siteId])
      : await pool.query("SELECT o.*,s.name AS site_name FROM orders o LEFT JOIN sites s ON s.id=o.site_id ORDER BY o.created_at DESC");
    res.json(r.rows.map(o=>({ id:o.id,siteId:o.site_id,siteName:o.site_name||"",placedBy:o.placed_by,approvedBy:o.approved_by,items:o.items||[],status:o.status,feedback:o.feedback,fulfillmentStatus:o.fulfillment_status,fulfilledQty:o.fulfilled_qty,pendingQty:o.pending_qty,fulfillmentRemarks:o.fulfillment_remarks,createdAt:o.created_at })));
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.post("/api/orders", async (req, res) => {
  try {
    const { id,siteId,placedBy,items,status } = req.body;
    const orderId = id||nextOrderId();
    const r = await pool.query(
      "INSERT INTO orders (id,site_id,placed_by,items,status) VALUES ($1,$2,$3,$4::jsonb,$5) RETURNING *",
      [orderId,Number(siteId),placedBy||"",JSON.stringify(items||[]),status||"Pending Approval"]
    );
    const o=r.rows[0];
    res.status(201).json({ id:o.id,siteId:o.site_id,placedBy:o.placed_by,items:o.items||[],status:o.status,createdAt:o.created_at });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.put("/api/orders/:id", async (req, res) => {
  try {
    const sets=[],vals=[];
    const { status,feedback,approvedBy,fulfillmentStatus,fulfilledQty,pendingQty,fulfillmentRemarks,items } = req.body;
    if (status!==undefined)             { sets.push(`status=$${sets.length+1}`);              vals.push(status); }
    if (feedback!==undefined)           { sets.push(`feedback=$${sets.length+1}`);            vals.push(feedback); }
    if (approvedBy!==undefined)         { sets.push(`approved_by=$${sets.length+1}`);         vals.push(approvedBy); }
    if (fulfillmentStatus!==undefined)  { sets.push(`fulfillment_status=$${sets.length+1}`);  vals.push(fulfillmentStatus); }
    if (fulfilledQty!==undefined)       { sets.push(`fulfilled_qty=$${sets.length+1}`);       vals.push(fulfilledQty); }
    if (pendingQty!==undefined)         { sets.push(`pending_qty=$${sets.length+1}`);         vals.push(pendingQty); }
    if (fulfillmentRemarks!==undefined) { sets.push(`fulfillment_remarks=$${sets.length+1}`); vals.push(fulfillmentRemarks); }
    if (items!==undefined)              { sets.push(`items=$${sets.length+1}::jsonb`);        vals.push(JSON.stringify(items)); }
    if (!sets.length) return res.status(400).json({ error:"Nothing to update" });
    vals.push(req.params.id);
    const r = await pool.query(`UPDATE orders SET ${sets.join(",")} WHERE id=$${vals.length} RETURNING *,site_id AS "siteId"`,vals);
    if (!r.rows.length) return res.status(404).json({ error:"Not found" });
    const o=r.rows[0];
    res.json({ id:o.id,siteId:o.site_id,placedBy:o.placed_by,approvedBy:o.approved_by,items:o.items||[],status:o.status,feedback:o.feedback,fulfillmentStatus:o.fulfillment_status,fulfilledQty:o.fulfilled_qty,pendingQty:o.pending_qty,fulfillmentRemarks:o.fulfillment_remarks,createdAt:o.created_at });
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ─── Reports ──────────────────────────────────────────────────────────────
app.get("/api/reports/stock-inward", async (req, res) => {
  try {
    const { startDate,endDate,siteIds } = req.query;
    const ids = siteIds ? siteIds.split(",").map(Number).filter(Boolean) : [];
    const siteFilter = ids.length ? "AND si.to_site_id = ANY($3::int[])" : "";
    const params = ids.length ? [startDate||"2000-01-01",endDate||"2099-12-31",ids] : [startDate||"2000-01-01",endDate||"2099-12-31"];
    const r = await pool.query(`
      SELECT si.id, si.dc_code, si.date, v.name AS vendor_name, s.name AS site_name,
             item->>'productCode' AS product_code, item->>'productName' AS product_name,
             item->>'hsnCode' AS hsn_code, item->>'mrp' AS mrp,
             item->>'gst' AS gst, item->>'qty' AS qty,
             p.brand, p.category, p.sub_category, p.uom, p.weight
      FROM stock_inwards si
      CROSS JOIN LATERAL jsonb_array_elements(si.items) AS item
      LEFT JOIN vendors v ON v.id=si.from_vendor_id
      LEFT JOIN sites   s ON s.id=si.to_site_id
      LEFT JOIN products p ON p.code=item->>'productCode'
      WHERE si.date >= $1 AND si.date <= $2 ${siteFilter}
      ORDER BY si.date DESC
    `, params);
    res.json(r.rows.map(row=>({ id:row.id,dcCode:row.dc_code,date:row.date,vendorName:row.vendor_name||"",siteName:row.site_name||"",productCode:row.product_code,productName:row.product_name,hsnCode:row.hsn_code||"",mrp:parseFloat(row.mrp)||0,gst:parseFloat(row.gst)||0,qty:parseFloat(row.qty)||0,brand:row.brand||"",category:row.category||"",subCategory:row.sub_category||"",uom:row.uom||"",weight:row.weight||"" })));
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.get("/api/reports/stock-offtake", async (req, res) => {
  try {
    const { startDate,endDate,siteIds } = req.query;
    const ids = siteIds ? siteIds.split(",").map(Number).filter(Boolean) : [];
    const start = new Date(startDate||"2000-01-01");
    const end   = new Date(endDate||new Date().toISOString().slice(0,10));
    const days  = Math.max(1,(end-start)/86400000);

    // Get all products at the requested sites
    const siteFilter = ids.length ? "AND su.site_id = ANY($1::int[])" : "";
    const params = ids.length ? [ids] : [];
    const products = await pool.query(`SELECT DISTINCT su.site_id,su.product_code,p.name,p.brand,p.category,p.sub_category,p.mrp,p.uom FROM stock_update su JOIN products p ON p.code=su.product_code ${siteFilter} ORDER BY p.name`, params);

    const rows = [];
    for (const prod of products.rows) {
      // Opening stock: last history record before start date
      const openR = await pool.query(`SELECT qty FROM stock_history WHERE site_id=$1 AND product_code=$2 AND updated_at<$3 ORDER BY updated_at DESC LIMIT 1`,[prod.site_id,prod.product_code,start.toISOString()]);
      const openStock = openR.rows.length ? parseFloat(openR.rows[0].qty) : 0;

      // Inwarded in period
      const inwardR = await pool.query(`SELECT COALESCE(SUM((item->>'qty')::numeric),0) AS total FROM stock_inwards si CROSS JOIN LATERAL jsonb_array_elements(si.items) AS item WHERE si.to_site_id=$1 AND item->>'productCode'=$2 AND si.date>=$3 AND si.date<=$4`,[prod.site_id,prod.product_code,start.toISOString(),end.toISOString()]);
      const inwarded = parseFloat(inwardR.rows[0]?.total)||0;

      // Closing stock: last history record on or before end date
      const closeR = await pool.query(`SELECT qty FROM stock_history WHERE site_id=$1 AND product_code=$2 AND updated_at<=$3 ORDER BY updated_at DESC LIMIT 1`,[prod.site_id,prod.product_code,end.toISOString()]);
      const closeStock = closeR.rows.length ? parseFloat(closeR.rows[0].qty) : openStock;

      const offtake = Math.max(0,openStock+inwarded-closeStock);
      const qtyPerDay = +(offtake/days).toFixed(4);

      rows.push({ siteId:prod.site_id,productCode:prod.product_code,productName:prod.name,brand:prod.brand||"",category:prod.category||"",subCategory:prod.sub_category||"",mrp:parseFloat(prod.mrp)||0,uom:prod.uom||"",openStock,inwarded,closeStock,offtake,days:+days.toFixed(1),qtyPerDay });
    }
    res.json(rows);
  } catch(e) { res.status(500).json({ error:e.message }); }
});

app.get("/api/reports/orders", async (req, res) => {
  try {
    const { startDate,endDate,siteIds } = req.query;
    const ids = siteIds ? siteIds.split(",").map(Number).filter(Boolean) : [];
    const siteFilter = ids.length ? "AND o.site_id = ANY($3::int[])" : "";
    const params = ids.length ? [startDate||"2000-01-01",endDate||"2099-12-31",ids] : [startDate||"2000-01-01",endDate||"2099-12-31"];
    const r = await pool.query(`
      SELECT o.*,s.name AS site_name FROM orders o
      LEFT JOIN sites s ON s.id=o.site_id
      WHERE o.created_at>=$1 AND o.created_at<=$2 ${siteFilter}
      ORDER BY o.created_at DESC
    `, params);
    res.json(r.rows.map(o=>({ id:o.id,siteName:o.site_name||"",placedBy:o.placed_by,approvedBy:o.approved_by,status:o.status,fulfillmentStatus:o.fulfillment_status,fulfilledQty:o.fulfilled_qty,pendingQty:o.pending_qty,fulfillmentRemarks:o.fulfillment_remarks,itemCount:o.items?.length||0,createdAt:o.created_at })));
  } catch(e) { res.status(500).json({ error:e.message }); }
});

// ─── Start ────────────────────────────────────────────────────────────────
initDB().then(() => {
  const PORT = process.env.PORT || 5000;
  app.listen(PORT, () => console.log(`✅ Pantry API running on port ${PORT}`));
}).catch(err => { console.error("❌ DB error:", err.message); process.exit(1); });
