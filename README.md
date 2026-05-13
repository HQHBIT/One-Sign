# HQHB · SignFlow

A full-stack, multi-role signature approval workflow.

**Stack:**
- **Backend** — Node.js + Express + MySQL (via `mysql2`), JWT auth (`bcryptjs`), real PDF signature stamping (`pdf-lib`), real email via SendGrid (with log-only fallback)
- **Frontend** — React 18 + Vite + Tailwind v4, SheetJS for Excel preview, native PDF preview
- **Database** — MySQL 5.7+ or 8.x (MariaDB 10.4+ also works)

---

## Prerequisites

1. **Node.js 18 or newer** — [nodejs.org](https://nodejs.org)
2. **A running MySQL server** you can connect to. Easy options:
   - **macOS:** `brew install mysql && brew services start mysql`
   - **Windows:** [MySQL Installer](https://dev.mysql.com/downloads/installer/) — pick "Server only"
   - **Ubuntu/Debian:** `sudo apt install mysql-server && sudo service mysql start`
   - **Docker:** `docker run --name mysql -e MYSQL_ROOT_PASSWORD=secret -p 3306:3306 -d mysql:8`
   - **XAMPP/MAMP** if you already have it — MySQL will be on port 3306 with root/(empty or chosen password)

You do **not** need to create a database beforehand. The server creates `signflow` on first boot.

---

## Running it (three commands)

From the unzipped project root:

```bash
npm run install:all
cp server/.env.example server/.env
npm run dev
```

- `install:all` installs deps at the root, then in `server/`, then in `client/`.
- Edit `server/.env` if your MySQL isn't at `localhost:3306` with user `root` and empty password.
- `npm run dev` starts **both** the API server (port 3001) and the Vite dev server (port 5173) in one terminal.

Open **http://localhost:5173** in your browser.

On first boot the backend creates the `signflow` database, migrates the schema, and seeds three accounts. You'll see a console banner confirming this.

---

## Seeded accounts

| Role      | Email                           | Password         |
| --------- | ------------------------------- | ---------------- |
| Admin     | `it@hqhb.in`                    | `Taha@011023`    |
| Requestor | `mufaddal.safdari@hqhb.in`      | `Mufaddal@1995`  |
| Approver  | `moiz.barwani@hqhb.in`          | `Moiz@9207`      |

The approver is pre-granted signing authority over **Finance Team** and **Operations Team**.

---

## Configuration — `server/.env`

```
# Server
PORT=3001
JWT_SECRET=change-me-to-a-long-random-string-for-production
APPROVAL_WINDOW_MS=3600000        # 1 hour reject window. Lower for demos.
CLIENT_ORIGIN=http://localhost:5173

# MySQL
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=signflow
# Optional — connect via Unix socket instead of TCP. Overrides DB_HOST/DB_PORT.
# DB_SOCKET_PATH=/var/run/mysqld/mysqld.sock

# SendGrid — leave SENDGRID_API_KEY blank to log emails in the DB without sending.
# Set it to enable real delivery.
SENDGRID_API_KEY=
SENDGRID_FROM_EMAIL=noreply@hqhb.in
SENDGRID_FROM_NAME=HQHB SignFlow
```

---

## What's real

Everything. No simulations, no placeholders.

- **Auth** — bcrypt-hashed passwords, JWT access tokens, role-based middleware
- **PDF signature stamping** — when an approver clicks Approve, `pdf-lib` takes the approver's signature image and bakes it into the PDF bytes at the marker coordinates. Download the signed version via the Approved tab.
- **1-hour reject window** — server-side; a scheduler ticks every 30 seconds and auto-finalises approvals past their window, sending the approval email to the requestor.
- **Team-based routing** — a request goes only to approvers with explicit `signing_authority` for the target team.
- **Email** — configured via SendGrid. When `SENDGRID_API_KEY` is set, real mail is sent. Otherwise every email is recorded in the database and visible in Admin → SendGrid log.
- **Bulk CSV user import** — paste CSV or upload a `.csv` file. Columns: `name,email,password,role,team,teams`.
- **Bulk signature upload** — drop PNG/JPG files named `<email>.png`; matched automatically against existing users.
- **Reports** — team-wise stats in the UI, full audit CSV via one-click download (`/api/reports/csv`).

---

## Shortening the 1-hour window for demos

Edit `server/.env`:
```
APPROVAL_WINDOW_MS=120000   # 2 minutes
```
Restart the server. The UI's countdown picks it up automatically.

Admins can also force-finalise any individual approval via the API (`POST /api/requests/:id/force-finalize`) — useful for testing the email-out flow without waiting.

---

## Project structure

```
signflow/
├── package.json               # concurrently runs server + client with npm run dev
├── server/
│   ├── .env.example
│   ├── package.json
│   ├── uploads/               # documents/, signatures/, signed/ (created on first use)
│   └── src/
│       ├── index.js           # Express entry + startup banner
│       ├── db.js              # MySQL pool, schema migration, seeding, hydrators
│       ├── auth.js            # JWT middleware + role guards
│       ├── email.js           # SendGrid + DB-log fallback
│       ├── pdf.js             # pdf-lib signature stamping
│       ├── scheduler.js       # 1-hour auto-finalisation tick
│       └── routes/
│           ├── auth.js        # /api/auth/login, /api/auth/me
│           ├── users.js       # users + bulk + signatures + self-signature
│           ├── teams.js       # teams + signing-authority grants
│           ├── requests.js    # full lifecycle — create, approve, reject, withdraw, reminder, download
│           └── admin.js       # /api/emails, /api/reports/*
└── client/
    ├── package.json           # Vite + React + Tailwind v4
    ├── vite.config.js         # proxies /api → http://localhost:3001
    ├── index.html
    └── src/
        ├── main.jsx
        ├── index.css          # Tailwind v4 import
        ├── api.js             # JWT-aware fetch wrapper; one function per endpoint
        └── App.jsx            # All UI — role-routed, ~1700 lines
```

---

## Database schema

On first boot the server runs:

```sql
CREATE DATABASE IF NOT EXISTS signflow;
```

…then creates seven tables inside it: `users`, `teams`, `signing_authority` (join table), `requests`, `reminders`, `emails`, plus three indexes on `requests`. All tables are InnoDB with `utf8mb4_unicode_ci`. Foreign keys are declared with `ON DELETE CASCADE` / `ON DELETE SET NULL` where appropriate. Passwords are stored as bcrypt hashes (cost factor 10).

You can inspect live data any time with any MySQL client (MySQL Workbench, TablePlus, DBeaver, `mysql` CLI):

```bash
mysql -u root -p signflow
mysql> SHOW TABLES;
mysql> SELECT id, email, role FROM users;
mysql> SELECT id, status, created_at FROM requests ORDER BY created_at DESC;
```

---

## Troubleshooting

**"Could not connect to MySQL"** — The server can't reach your MySQL. Verify:
- `mysql -u root -p` from the command line works
- Host/port/user/password in `server/.env` match your MySQL setup
- On Linux you may need `DB_SOCKET_PATH=/var/run/mysqld/mysqld.sock`

**"Access denied for user 'root'@'localhost'"** — Your MySQL root has a password. Put it in `DB_PASSWORD` in `server/.env`.

**PDF preview is blank in Chrome** — Should work fine, but if it doesn't: try Firefox, or verify the server is returning the file (open `http://localhost:3001/api/requests/<id>/file` with a JWT in the Authorization header via a tool like Postman). The client uses blob URLs so there's no CORS or auth issue in the iframe.

**"Add your signature first"** error — The requestor/approver must register a signature before their first action. This is shown as a modal on login.

**Port 3001 already in use** — Change `PORT=3001` in `server/.env`, and also change the `target` in `client/vite.config.js` to match.

**Port 5173 already in use** — Change `server` `port` in `client/vite.config.js`, and update `CLIENT_ORIGIN` in `server/.env` to match.

---

## Going to production

The architecture is already production-shaped. For a live deployment you'd want:

1. **Real JWT secret** — generate `JWT_SECRET` with `openssl rand -base64 48`
2. **HTTPS** — put nginx/Caddy in front; use a real certificate
3. **File storage** — swap `uploads/` for S3 or equivalent. The only files that touch disk are in `server/src/routes/requests.js` (documents) and `server/src/routes/users.js` (signatures) — well-contained.
4. **Database migrations** — current setup auto-migrates on boot; for production replace with `knex`, `prisma`, or hand-rolled migration scripts.
5. **Rate limiting** — add `express-rate-limit` on `/api/auth/login`.
6. **Refresh tokens** — current JWT is 30 days. For production, issue short-lived access + refresh pairs.
7. **CSRF** — not needed with the current Bearer-token design, but do add it if you move to cookie-based auth.
8. **Email deliverability** — verify your sender domain in SendGrid (SPF, DKIM) before going live.

---

## License

Internal — HQHB.
