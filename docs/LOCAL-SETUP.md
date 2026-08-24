# Running SignFlow locally

Everything needed to run the full stack on a development machine and exercise
the multi-organisation setup.

---

## Prerequisites

| | |
|---|---|
| Node | 20 or newer |
| MySQL | listening on 3306, with a `signflow` database |
| `server/.env` | DB credentials, `JWT_SECRET`, and anything else the server reads |

`server/.env` is gitignored and never committed. If it is missing, copy the
shape below and fill in your own values:

```
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=...
DB_NAME=signflow
JWT_SECRET=...
```

First time only:

```bash
npm run install:all
```

---

## Run it

From the repository root:

```bash
npm run dev
```

That starts both halves together — the API on **5001** and the client on
**5173**. Vite proxies `/api` through to the API, so the browser only ever talks
to 5173.

Open **http://localhost:5173**.

The schema migrates itself on boot. There is no separate migration step, and
running it repeatedly is safe.

---

## Demo data

Six accounts across both organisations, with departments that deliberately share
names (`IT` and `Communications` exist in both) to exercise organisation-scoped
uniqueness:

```bash
cd server
node --env-file=.env scripts/seed-demo-users.mjs
```

It prints the credentials once. **Passwords are generated fresh on every run and
are never stored in the repository**, so re-running gives new ones. Everything it
creates is prefixed `demo_` / `@demo.local`.

To remove all of it:

```bash
node --env-file=.env scripts/seed-demo-users.mjs --purge
```

The script refuses to run against a non-local `DB_HOST`. It creates accounts with
known credentials, which on a real database would be a live way in.

Accounts it creates:

| Organisation | Role | Notes |
|---|---|---|
| WAQF | requestor, approver, admin | approver signs for WAQF · IT |
| HQHB | requestor, approver | approver signs for HQHB · IT |
| HQHB | approver, **global** | also holds authority over WAQF · Communications |

---

## What to try

**The organisation picker.** The landing page offers one tile per organisation.
HQHB shows oneAccess plus password; WAQF shows password only — its door never
offers SSO, whatever this server has configured.

**Cross-organisation refusal.** Choose WAQF, then sign in with an HQHB account.
It is refused, and the refusal is deliberately identical to a wrong password so
the form cannot be used to work out which organisation an address belongs to.

**Signature box sizing.** Create a request, attach a PDF, and place a signature
box. Small / Standard / Large set the height in millimetres (12 / 16 / 22); the
width follows the signer's own stored signature, so the stamp fills the box
exactly. Dragging a corner keeps the shape and lands on a whole millimetre, with
a live millimetre readout.

**Signatures are no longer stretched.** `fitContain()` fits the image inside its
box preserving proportions, so preview and stamped output finally agree.

To see the picker again after choosing once:

```js
localStorage.removeItem("signflow.org")
```

---

## Tests

```bash
# unit — no database, no server
node client/test/boxSize.test.mjs
node client/test/signatureCutout.test.mjs
cd server && node test/fitContain.test.mjs
node test/stampDate.test.mjs
node test/applySelfMarks.test.mjs

# integration — needs the API running AND the env file loaded
cd server && node --env-file=.env test/organisations.migration.mjs
node --env-file=.env test/org-login-isolation.integration.mjs
```

---

## Things that will trip you up

**Integration tests do not load dotenv themselves.** Without `--env-file=.env`
they fail with `Access denied for user 'root'@'localhost' (using password: NO)`,
which looks like a code fault and is not. They also need the API already running.

**Vite binds to `localhost`, not `127.0.0.1`.** `curl http://127.0.0.1:5173`
returns nothing while the browser works fine. Use `localhost`.

**The client registers a service worker.** After changing client code, a normal
refresh can still serve the cached bundle. Hard-reload with Ctrl+Shift+R.

**Some suites fail for reasons unrelated to your change.** `expenses` (that
feature is commented out), `oneaccess-upsert`, `security`, `self-sign` and
`signer-date` fail on a clean checkout too. `security` and `events` build paths
with `path.join("server", …)` while running *from* `server/`, so they write to
`server/server/…` and the file never lands where the server looks. Before
chasing a failure, check it against the previous commit.

**`workflow-validity` is flaky on Windows** — `Assertion failed:
!(handle->flags & UV_HANDLE_CLOSING)` is libuv aborting during process teardown,
not a test assertion.

---

## What is local-only

The demo accounts and demo departments exist **only** in your local database.
Production has both organisations but no WAQF users, deliberately: query-level
organisation isolation is not built yet, so a WAQF user on live would still see
HQHB's teams and people. See `docs/OPEN-ITEMS.md`.
