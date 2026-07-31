# Hearth & Mark — MariaDB backend

This turns the localStorage demo into a real client/server app: MariaDB stores the
data, a small Express API serves it, and the existing HTML/JS front end talks to
that API over `fetch()` instead of `localStorage`.

## 1. Set up MariaDB

```bash
sudo apt install mariadb-server        # or your platform's equivalent
sudo mysql -u root
```

```sql
CREATE USER 'hearthmark'@'localhost' IDENTIFIED BY 'choose-a-real-password';
GRANT ALL PRIVILEGES ON hearth_mark.* TO 'hearthmark'@'localhost';
FLUSH PRIVILEGES;
```

Then load the schema:

```bash
mysql -u hearthmark -p < schema.sql
```

The schema seeds one admin account (`admin` / `changeme123`) and the same nine
demo products the front end currently ships with. **Change that password before
going live** — generate a new hash with:

```bash
node -e "console.log(require('bcryptjs').hashSync('your-new-password', 10))"
```
and paste it into the `users` table's `password_hash` column for the admin row.

## 2. Run the API

```bash
cd hearth-mark-api
cp .env.example .env      # fill in DB_PASSWORD, JWT_SECRET, CORS_ORIGIN
npm install
npm start                 # or `npm run dev` for auto-restart on changes
```

It listens on `http://localhost:4000` (or whatever `PORT` you set).

## 3. Rewire the front end

The HTML file currently keeps everything in `localStorage` via functions like
`loadProducts()`, `saveOrders()`, `handleLogin()`, etc. You don't need to touch
the rendering functions (`renderProducts`, `renderCart`, `renderAdminTable`...) —
only the data functions that read/write `localStorage`. Below is the mapping.

### API base + auth token

Add near the top of the `<script>` block:

```js
const API_BASE = 'http://localhost:4000/api';
let AUTH_TOKEN = null; // kept in memory only — not localStorage (tokens shouldn't sit in
                        // client-readable storage long-term; see note at the end)

async function api(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(AUTH_TOKEN ? { Authorization: `Bearer ${AUTH_TOKEN}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
```

### Auth — replaces `handleLogin`, `handleSignup`, `getSession`/`setSession`

```js
let CURRENT_USER = null; // { username, name, role }

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;
  try {
    const { token, user } = await api('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    AUTH_TOKEN = token;
    CURRENT_USER = user;
    closeModal('loginOverlay');
    renderAccountArea();
    showToast(`Welcome back, ${user.name || user.username}.`);
  } catch (err) {
    const errEl = document.getElementById('loginError');
    errEl.textContent = err.message;
    errEl.classList.add('show');
  }
  return false;
}
```

`handleSignup` follows the same pattern against `POST /auth/signup`.
Replace every call to `currentUser()` with `CURRENT_USER` directly (or a
function that just returns it) — there's no need to look it up from a users
array anymore, since the server is the source of truth.

### Products — replaces `loadProducts`/`saveProducts`

```js
async function loadProducts() { PRODUCTS = await api('/products'); renderAll(); }
async function saveProductForm(e) {
  e.preventDefault();
  const id = document.getElementById('pfId').value;
  const data = { /* same fields you already build */ };
  if (id) await api(`/products/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  else await api('/products', { method: 'POST', body: JSON.stringify(data) });
  await loadProducts();
  closeModal('productFormOverlay');
  showToast('Listing saved.');
  return false;
}
async function deleteProduct(id) {
  if (!confirm('Delete this listing? This cannot be undone.')) return;
  await api(`/products/${id}`, { method: 'DELETE' });
  await loadProducts();
}
```

Call `await loadProducts()` once on page load instead of the synchronous
`PRODUCTS = loadProducts()`.

### Orders — replaces `submitDelivery`'s localStorage write

```js
async function submitDelivery(e) {
  e.preventDefault();
  const delivery = { /* same fields you already collect */ };
  const items = CART.map(i => ({ productId: i.productId, qty: i.qty, lines: i.lines }));
  try {
    const { orderNo } = await api('/orders', { method: 'POST', body: JSON.stringify({ items, delivery }) });
    CART = [];
    renderCart(); updateCartBadge();
    closeModal('deliveryOverlay'); closeModal('cartOverlay');
    showToast(`Order placed — confirmation ${orderNo}.`);
  } catch (err) {
    document.getElementById('deliveryError').textContent = err.message;
    document.getElementById('deliveryError').classList.add('show');
  }
  return false;
}
```

Note the server now re-checks stock and re-computes prices itself — it never
trusts totals sent from the browser. This also means product stock is
decremented for real, so keep `renderAdminOrders` fetching from
`GET /orders` (admin-only) instead of a local array.

### Messages — replaces the `MESSAGES` localStorage array

- Customer: `GET /messages/mine` to load the thread, `POST /messages/mine` to send.
- Admin: `GET /messages/threads` to list all conversations, `POST /messages/threads/:username` to reply.

### Cart

Leave the cart in a plain in-memory `CART` array (or `sessionStorage` if you
want it to survive a refresh) — a basket someone hasn't bought yet doesn't
need a database row.

## 4. Things this still doesn't handle (worth knowing before going live)

- **HTTPS** — put the API behind a reverse proxy (nginx/Caddy) with TLS in
  production; don't send passwords over plain HTTP.
- **Token storage** — for a real site, prefer an httpOnly cookie set by the
  server over keeping the JWT in a JS variable, so it isn't readable by any
  injected script.
- **Rate limiting** on `/auth/login` and `/auth/signup` to slow down brute-force attempts.
- **Payments** — none of this takes real payment; you'd add Stripe/PayPal
  around the order-creation step.
- **Input validation** — the routes here do basic checks; consider a schema
  validator (e.g. `zod`) for anything user-facing before production traffic.
- **Migrations** — `schema.sql` is a one-shot setup script; for an evolving
  schema you'll want a migration tool (e.g. `node-pg-migrate`'s MySQL
  equivalents, or Prisma/Knex).