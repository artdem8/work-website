import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import path from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import { pool } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..')));

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('JWT_SECRET is not set in .env — refusing to start.');
  process.exit(1);
}

/* ---------------- auth helpers ---------------- */

function signToken(user) {
  return jwt.sign(
    { username: user.username, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not logged in.' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired, please log in again.' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

// attaches req.user if a valid token is present, but doesn't block the request
function optionalAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (token) {
    try { req.user = jwt.verify(token, JWT_SECRET); } catch { /* ignore */ }
  }
  next();
}

/* ---------------- auth routes ---------------- */

app.post('/api/auth/signup', async (req, res) => {
  const { name, username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password required.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });

  const [existing] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
  if (existing.length) return res.status(409).json({ error: 'That username is already taken.' });

  const hash = await bcrypt.hash(password, 10);
  await pool.query(
    'INSERT INTO users (username, name, password_hash, role) VALUES (?, ?, ?, "customer")',
    [username, name || null, hash]
  );
  const user = { username, name, role: 'customer' };
  res.json({ token: signToken(user), user });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body || {};
  const [rows] = await pool.query('SELECT * FROM users WHERE username = ?', [username || '']);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password || '', user.password_hash))) {
    return res.status(401).json({ error: 'Incorrect username or password.' });
  }
  res.json({ token: signToken(user), user: { username: user.username, name: user.name, role: user.role } });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

/* ---------------- products ---------------- */

app.get('/api/products', async (_req, res) => {
  const [rows] = await pool.query('SELECT * FROM products ORDER BY created_at ASC');
  res.json(rows.map(toProductJson));
});

app.post('/api/products', requireAuth, requireAdmin, async (req, res) => {
  const p = req.body || {};
  const id = 'p' + Date.now();
  await pool.query(
    `INSERT INTO products (id, name, category, description, price, discount, stock, personalise, lines)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, p.name, p.category, p.desc || '', p.price, p.discount || 0, p.stock || 0, !!p.personalise, p.personalise ? (p.lines || 1) : 0]
  );
  res.status(201).json({ id });
});

app.put('/api/products/:id', requireAuth, requireAdmin, async (req, res) => {
  const p = req.body || {};
  const [result] = await pool.query(
    `UPDATE products SET name=?, category=?, description=?, price=?, discount=?, stock=?, personalise=?, lines=?
     WHERE id=?`,
    [p.name, p.category, p.desc || '', p.price, p.discount || 0, p.stock || 0, !!p.personalise,
     p.personalise ? (p.lines || 1) : 0, req.params.id]
  );
  if (result.affectedRows === 0) return res.status(404).json({ error: 'Listing not found.' });
  res.json({ ok: true });
});

app.delete('/api/products/:id', requireAuth, requireAdmin, async (req, res) => {
  await pool.query('DELETE FROM products WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

function toProductJson(row) {
  return {
    id: row.id, name: row.name, category: row.category, desc: row.description,
    price: Number(row.price), discount: row.discount, stock: row.stock,
    personalise: !!row.personalise, lines: row.lines
  };
}

/* ---------------- orders ---------------- */

app.post('/api/orders', optionalAuth, async (req, res) => {
  const { items, delivery } = req.body || {};
  if (!Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'Basket is empty.' });
  if (!delivery || !delivery.name || !delivery.address1 || !delivery.city || !delivery.postcode || !delivery.country) {
    return res.status(400).json({ error: 'Missing delivery details.' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let total = 0;
    const priced = [];
    for (const item of items) {
      const [rows] = await conn.query('SELECT * FROM products WHERE id = ? FOR UPDATE', [item.productId]);
      const product = rows[0];
      if (!product) throw new Error(`Product ${item.productId} not found.`);
      const qty = Math.max(1, parseInt(item.qty) || 1);
      if (product.stock < qty) throw new Error(`Not enough stock for ${product.name}.`);
      const unit = Number(product.price) * (1 - product.discount / 100);
      const lineTotal = unit * qty;
      total += lineTotal;
      priced.push({ product, qty, unit, lineTotal, lines: Array.isArray(item.lines) ? item.lines.slice(0, product.lines) : [] });
      await conn.query('UPDATE products SET stock = stock - ? WHERE id = ?', [qty, product.id]);
    }

    const id = 'o' + Date.now();
    const orderNo = 'HM-' + Math.floor(100000 + Math.random() * 900000);
    await conn.query(
      `INSERT INTO orders (id, order_no, username, customer_name, total, status,
         address1, address2, city, postcode, country, phone, notes)
       VALUES (?, ?, ?, ?, ?, 'Placed', ?, ?, ?, ?, ?, ?, ?)`,
      [id, orderNo, req.user ? req.user.username : null, delivery.name, total,
       delivery.address1, delivery.address2 || '', delivery.city, delivery.postcode,
       delivery.country, delivery.phone || '', delivery.notes || '']
    );
    for (const item of priced) {
      await conn.query(
        `INSERT INTO order_items (order_id, product_id, name, unit_price, qty, line_total, personalise_lines)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, item.product.id, item.product.name, item.unit, item.qty, item.lineTotal, JSON.stringify(item.lines)]
      );
    }

    await conn.commit();
    res.status(201).json({ orderNo, total });
  } catch (err) {
    await conn.rollback();
    res.status(400).json({ error: err.message });
  } finally {
    conn.release();
  }
});

app.get('/api/orders', requireAuth, requireAdmin, async (_req, res) => {
  const [orders] = await pool.query('SELECT * FROM orders ORDER BY created_at DESC');
  const [items] = await pool.query('SELECT * FROM order_items');
  const byOrder = {};
  items.forEach(i => { (byOrder[i.order_id] ||= []).push(i); });
  res.json(orders.map(o => ({
    id: o.id, orderNo: o.order_no, username: o.username, customerName: o.customer_name,
    total: Number(o.total), status: o.status, createdAt: o.created_at,
    delivery: { address1: o.address1, address2: o.address2, city: o.city, postcode: o.postcode, country: o.country, phone: o.phone, notes: o.notes },
    items: (byOrder[o.id] || []).map(i => ({
      productId: i.product_id, name: i.name, unit: Number(i.unit_price), qty: i.qty,
      lineTotal: Number(i.line_total), lines: JSON.parse(i.personalise_lines || '[]')
    }))
  })));
});

app.patch('/api/orders/:id/status', requireAuth, requireAdmin, async (req, res) => {
  const { status } = req.body || {};
  const allowed = ['Placed', 'Processing', 'Shipped', 'Delivered'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
  await pool.query('UPDATE orders SET status = ? WHERE id = ?', [status, req.params.id]);
  res.json({ ok: true });
});

/* ---------------- messages ---------------- */

app.get('/api/messages/mine', requireAuth, async (req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM messages WHERE customer_username = ? ORDER BY created_at ASC', [req.user.username]
  );
  await pool.query(
    'UPDATE messages SET read_by_customer = TRUE WHERE customer_username = ? AND sender = "admin"',
    [req.user.username]
  );
  res.json(rows.map(toMessageJson));
});

app.post('/api/messages/mine', requireAuth, async (req, res) => {
  const { body } = req.body || {};
  if (!body || !body.trim()) return res.status(400).json({ error: 'Message body required.' });
  const id = 'm' + Date.now();
  await pool.query(
    `INSERT INTO messages (id, customer_username, customer_name, sender, body, read_by_customer)
     VALUES (?, ?, ?, 'customer', ?, TRUE)`,
    [id, req.user.username, req.user.name, body.trim()]
  );
  res.status(201).json({ id });
});

app.get('/api/messages/threads', requireAuth, requireAdmin, async (_req, res) => {
  const [rows] = await pool.query('SELECT * FROM messages ORDER BY created_at ASC');
  const threads = {};
  rows.forEach(m => {
    (threads[m.customer_username] ||= { customerName: m.customer_name, messages: [] })
      .messages.push(toMessageJson(m));
  });
  res.json(threads);
});

app.post('/api/messages/threads/:username', requireAuth, requireAdmin, async (req, res) => {
  const { body } = req.body || {};
  if (!body || !body.trim()) return res.status(400).json({ error: 'Message body required.' });
  const [existing] = await pool.query(
    'SELECT customer_name FROM messages WHERE customer_username = ? LIMIT 1', [req.params.username]
  );
  if (!existing.length) return res.status(404).json({ error: 'No conversation with that customer yet.' });
  const id = 'm' + Date.now();
  await pool.query(
    `INSERT INTO messages (id, customer_username, customer_name, sender, body, read_by_admin)
     VALUES (?, ?, ?, 'admin', ?, TRUE)`,
    [id, req.params.username, existing[0].customer_name, body.trim()]
  );
  await pool.query(
    'UPDATE messages SET read_by_admin = TRUE WHERE customer_username = ? AND sender = "customer"',
    [req.params.username]
  );
  res.status(201).json({ id });
});

function toMessageJson(m) {
  return {
    id: m.id, customerUsername: m.customer_username, customerName: m.customer_name,
    sender: m.sender, body: m.body, createdAt: m.created_at,
    readByAdmin: !!m.read_by_admin, readByCustomer: !!m.read_by_customer
  };
}

/* ---------------- start ---------------- */

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Hearth & Mark API listening on :${PORT}`));