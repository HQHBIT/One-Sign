import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";

const {
  DB_HOST = "localhost",
  DB_PORT = "3306",
  DB_USER = "root",
  DB_PASSWORD = "",
  DB_NAME = "signflow",
  DB_SOCKET_PATH = ""
} = process.env;

// Prefer socket when provided (helpful on some Linux setups); fall back to TCP otherwise.
const baseConfig = {
  user: DB_USER,
  password: DB_PASSWORD,
  charset: "utf8mb4",
  dateStrings: false,
  supportBigNumbers: true,
  namedPlaceholders: false,
  multipleStatements: false,
  ...(DB_SOCKET_PATH
    ? { socketPath: DB_SOCKET_PATH }
    : { host: DB_HOST, port: parseInt(DB_PORT, 10) })
};

let pool = null;

/** Public — obtain the pool (must be called after init()). */
export function getPool() {
  if (!pool) throw new Error("DB not initialised. Call initDb() first.");
  return pool;
}

/** Convenience query wrappers. */
export async function query(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}
export async function queryOne(sql, params = []) {
  const [rows] = await pool.execute(sql, params);
  return rows[0] || null;
}
export async function execute(sql, params = []) {
  const [result] = await pool.execute(sql, params);
  return result;
}

// ============================================================
//   INIT: create DB if absent, run schema, seed
// ============================================================
export async function initDb() {
  // 1) Connect without a schema to ensure the database exists.
  const bootstrap = await mysql.createConnection(baseConfig);
  await bootstrap.query(
    `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await bootstrap.end();

  // 2) Now create a pool against the database.
  pool = mysql.createPool({ ...baseConfig, database: DB_NAME, waitForConnections: true, connectionLimit: 10 });

  // 3) Schema migration — idempotent DDL.
  await runSchema();

  // 4) Seed if empty.
  await seedIfEmpty();

  console.log(`[db] MySQL connected → ${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}`);
}

async function tryExec(sql) {
  try { await pool.query(sql); }
  catch (e) {
    const code = e?.code || "";
    const ignorable = [
      "ER_DUP_FIELDNAME", "ER_DUP_KEYNAME", "ER_TABLE_EXISTS_ERROR",
      "ER_CANT_DROP_FIELD_OR_KEY", "ER_FK_DUP_NAME", "ER_DUP_CONSTRAINT_NAME"
    ];
    if (ignorable.includes(code)) return;
    // 1060 dup col, 1061 dup key, 1050 table exists, 1091 can't drop FK, 1826 dup FK name, 3822 dup check name
    if ([1060, 1061, 1050, 1091, 1826, 3822].includes(e?.errno)) return;
    console.warn(`[db migrate] ${sql.slice(0, 80)}… → ${code || e?.errno}: ${e.message}`);
    throw e;
  }
}

async function runSchema() {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS teams (
      id            VARCHAR(64)  NOT NULL PRIMARY KEY,
      name          VARCHAR(191) NOT NULL UNIQUE,
      created_at    BIGINT       NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS users (
      id              VARCHAR(64)  NOT NULL PRIMARY KEY,
      email           VARCHAR(191) NOT NULL UNIQUE,
      password_hash   VARCHAR(255) NOT NULL,
      name            VARCHAR(191) NOT NULL,
      role            ENUM('admin','requestor','approver') NOT NULL,
      signature_path  VARCHAR(255) DEFAULT NULL,
      team_id         VARCHAR(64)  DEFAULT NULL,
      created_at      BIGINT       NOT NULL,
      CONSTRAINT fk_users_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS signing_authority (
      user_id  VARCHAR(64) NOT NULL,
      team_id  VARCHAR(64) NOT NULL,
      PRIMARY KEY (user_id, team_id),
      CONSTRAINT fk_sa_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_sa_team FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS requests (
      id                     VARCHAR(64)  NOT NULL PRIMARY KEY,
      requestor_id           VARCHAR(64)  NOT NULL,
      file_name              VARCHAR(255) NOT NULL,
      file_path              VARCHAR(255) NOT NULL,
      file_type              ENUM('pdf','xlsx') NOT NULL,
      target_team_id         VARCHAR(64)  NOT NULL,
      marker_json            TEXT         NOT NULL,
      note                   TEXT,
      status                 ENUM('pending','approved_pending','approved','rejected') NOT NULL,
      created_at             BIGINT       NOT NULL,
      approver_id            VARCHAR(64)  DEFAULT NULL,
      approved_at            BIGINT       DEFAULT NULL,
      finalized_at           BIGINT       DEFAULT NULL,
      rejected_at            BIGINT       DEFAULT NULL,
      reject_reason          TEXT,
      applied_signature_path VARCHAR(255) DEFAULT NULL,
      signed_file_path       VARCHAR(255) DEFAULT NULL,
      INDEX idx_requests_status (status),
      INDEX idx_requests_requestor (requestor_id),
      INDEX idx_requests_team (target_team_id),
      CONSTRAINT fk_req_requestor FOREIGN KEY (requestor_id) REFERENCES users(id),
      CONSTRAINT fk_req_team FOREIGN KEY (target_team_id) REFERENCES teams(id),
      CONSTRAINT fk_req_approver FOREIGN KEY (approver_id) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS reminders (
      id          INT AUTO_INCREMENT PRIMARY KEY,
      request_id  VARCHAR(64) NOT NULL,
      sent_at     BIGINT NOT NULL,
      INDEX idx_reminders_request (request_id),
      CONSTRAINT fk_rem_request FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS emails (
      id         INT AUTO_INCREMENT PRIMARY KEY,
      to_email   VARCHAR(191) NOT NULL,
      subject    VARCHAR(500) NOT NULL,
      body       TEXT         NOT NULL,
      template   VARCHAR(64)  NOT NULL,
      sent_at    BIGINT       NOT NULL,
      delivered  TINYINT(1)   NOT NULL DEFAULT 0,
      error      TEXT,
      INDEX idx_emails_sentat (sent_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS request_steps (
      id           VARCHAR(64)  NOT NULL PRIMARY KEY,
      request_id   VARCHAR(64)  NOT NULL,
      step_order   INT          NOT NULL,
      team_id      VARCHAR(64)  NOT NULL,
      status       ENUM('pending','active','done','rejected') NOT NULL DEFAULT 'pending',
      created_at   BIGINT       NOT NULL,
      UNIQUE KEY uq_request_step (request_id, step_order),
      INDEX idx_steps_request (request_id),
      CONSTRAINT fk_steps_request FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE,
      CONSTRAINT fk_steps_team FOREIGN KEY (team_id) REFERENCES teams(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,

    `CREATE TABLE IF NOT EXISTS request_step_signers (
      id              VARCHAR(64)  NOT NULL PRIMARY KEY,
      step_id         VARCHAR(64)  NOT NULL,
      signer_order    INT          NOT NULL,
      user_id         VARCHAR(64)  NOT NULL,
      page            INT          NOT NULL DEFAULT 1,
      marker_x        DOUBLE       NOT NULL,
      marker_y        DOUBLE       NOT NULL,
      marker_w        DOUBLE       NOT NULL,
      marker_h        DOUBLE       NOT NULL,
      status          ENUM('pending','signed','rejected') NOT NULL DEFAULT 'pending',
      signed_at       BIGINT       DEFAULT NULL,
      signature_path  VARCHAR(255) DEFAULT NULL,
      INDEX idx_signers_step (step_id),
      INDEX idx_signers_user (user_id),
      CONSTRAINT fk_signers_step FOREIGN KEY (step_id) REFERENCES request_steps(id) ON DELETE CASCADE,
      CONSTRAINT fk_signers_user FOREIGN KEY (user_id) REFERENCES users(id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  ];
  for (const s of stmts) await pool.query(s);

  // Idempotent column additions for legacy installs
  await tryExec(`ALTER TABLE requests ADD COLUMN instant_approval TINYINT(1) NOT NULL DEFAULT 0`);
  await tryExec(`ALTER TABLE requests ADD COLUMN current_step INT NOT NULL DEFAULT 0`);
  await tryExec(`ALTER TABLE requests MODIFY COLUMN marker_json TEXT NULL`);
  await tryExec(`ALTER TABLE requests MODIFY COLUMN target_team_id VARCHAR(64) NULL`);

  // Track the viewer rotation the requestor was using when they placed each signer's
  // marker. Server pre-rotates the signature by this amount so it aligns with the page
  // text in whatever orientation the requestor intended.
  await tryExec(`ALTER TABLE request_step_signers ADD COLUMN rotation INT NOT NULL DEFAULT 0`);

  // Quick Actions: classify each request by type so requestors pick a flow up-front and
  // approvers can filter / batch-approve same-type requests together.
  await tryExec(`ALTER TABLE requests ADD COLUMN request_type VARCHAR(32) NOT NULL DEFAULT 'general'`);

  // Native width/height ratio of the signature image, persisted on upload so the
  // requestor's marker box can snap to that aspect at placement time.
  await tryExec(`ALTER TABLE users ADD COLUMN signature_aspect DOUBLE DEFAULT NULL`);

  // Plaintext copy of the most recent temp password set by the reset / invite
  // / forgot-password flows. Kept ALONGSIDE the bcrypt hash (which is what we
  // actually use for authentication). Visible to admins on the Users page so
  // they can share credentials manually with users who don't have email
  // access. Persists until the next reset on that user.
  // SECURITY NOTE: This is an internal-tool tradeoff. Standard apps never
  // store plaintext passwords. If this code is repurposed for a public
  // product, remove these columns and rely on the email log instead.
  await tryExec(`ALTER TABLE users ADD COLUMN last_temp_password VARCHAR(64) DEFAULT NULL`);
  await tryExec(`ALTER TABLE users ADD COLUMN last_temp_password_at BIGINT DEFAULT NULL`);

  // Allow user deletion: make user-referencing columns nullable + change FKs to ON DELETE SET NULL.
  // Each ALTER is independent and idempotent (tryExec swallows "duplicate"/"unknown FK" errors).
  await tryExec(`ALTER TABLE requests MODIFY COLUMN requestor_id VARCHAR(64) NULL`);
  await tryExec(`ALTER TABLE request_step_signers MODIFY COLUMN user_id VARCHAR(64) NULL`);

  // Drop existing strict FKs (errors are ignored if FK was already replaced)
  await tryExec(`ALTER TABLE requests DROP FOREIGN KEY fk_req_requestor`);
  await tryExec(`ALTER TABLE requests DROP FOREIGN KEY fk_req_approver`);
  await tryExec(`ALTER TABLE request_step_signers DROP FOREIGN KEY fk_signers_user`);

  // Re-add with ON DELETE SET NULL
  await tryExec(`ALTER TABLE requests ADD CONSTRAINT fk_req_requestor FOREIGN KEY (requestor_id) REFERENCES users(id) ON DELETE SET NULL`);
  await tryExec(`ALTER TABLE requests ADD CONSTRAINT fk_req_approver FOREIGN KEY (approver_id) REFERENCES users(id) ON DELETE SET NULL`);
  await tryExec(`ALTER TABLE request_step_signers ADD CONSTRAINT fk_signers_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL`);
}

async function seedIfEmpty() {
  const [rows] = await pool.query("SELECT COUNT(*) AS n FROM users");
  if (rows[0].n > 0) return;

  const now = Date.now();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const teams = [
      { id: "t_finance", name: "Finance Team" },
      { id: "t_it",      name: "IT Team" },
      { id: "t_ops",     name: "Operations Team" }
    ];
    for (const t of teams) {
      await conn.execute("INSERT INTO teams (id, name, created_at) VALUES (?, ?, ?)", [t.id, t.name, now]);
    }

    const users = [
      { id: "u_admin", email: "it@hqhb.in", password: "Taha@011023", name: "Taha (Admin)", role: "admin", team_id: null },
      { id: "u_req",   email: "mufaddal.safdari@hqhb.in", password: "Mufaddal@1995", name: "Mufaddal Safdari", role: "requestor", team_id: "t_finance" },
      { id: "u_app",   email: "moiz.barwani@hqhb.in", password: "Moiz@9207", name: "Moiz Barwani", role: "approver", team_id: null }
    ];
    for (const u of users) {
      const hash = bcrypt.hashSync(u.password, 10);
      await conn.execute(
        "INSERT INTO users (id, email, password_hash, name, role, team_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [u.id, u.email, hash, u.name, u.role, u.team_id, now]
      );
    }

    await conn.execute("INSERT INTO signing_authority (user_id, team_id) VALUES (?, ?)", ["u_app", "t_finance"]);
    await conn.execute("INSERT INTO signing_authority (user_id, team_id) VALUES (?, ?)", ["u_app", "t_ops"]);

    await conn.commit();
    console.log("[db] Seeded 3 users + 3 teams.");
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

// ============================================================
//   Hydrators — shape rows for the API
// ============================================================
export async function hydrateUser(row) {
  if (!row) return null;
  const [auth] = await pool.execute("SELECT team_id FROM signing_authority WHERE user_id = ?", [row.id]);
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    team: row.team_id,
    hasSignature: !!row.signature_path,
    signatureAspect: row.signature_aspect != null ? Number(row.signature_aspect) : null,
    signingAuthorityTeams: auth.map(r => r.team_id),
    // Plaintext most-recent temp password — only meaningful right after reset
    // / invite / forgot-password. Falls back to null otherwise.
    lastTempPassword: row.last_temp_password || null,
    lastTempPasswordAt: row.last_temp_password_at != null ? Number(row.last_temp_password_at) : null
  };
}

export async function hydrateRequest(row) {
  if (!row) return null;
  const [rems] = await pool.execute(
    "SELECT sent_at FROM reminders WHERE request_id = ? ORDER BY sent_at ASC",
    [row.id]
  );
  const [names] = await pool.execute(
    "SELECT u1.name AS requestor_name, u2.name AS approver_name FROM (SELECT 1) x " +
    "LEFT JOIN users u1 ON u1.id = ? LEFT JOIN users u2 ON u2.id = ?",
    [row.requestor_id, row.approver_id || null]
  );

  // Workflow steps + signers (with user names)
  const [steps] = await pool.execute(
    "SELECT * FROM request_steps WHERE request_id = ? ORDER BY step_order ASC",
    [row.id]
  );
  const stepIds = steps.map(s => s.id);
  let signers = [];
  if (stepIds.length > 0) {
    const placeholders = stepIds.map(() => "?").join(",");
    const [sgn] = await pool.execute(
      `SELECT s.*, u.name AS user_name, u.email AS user_email
         FROM request_step_signers s
         LEFT JOIN users u ON u.id = s.user_id
        WHERE s.step_id IN (${placeholders})
        ORDER BY s.step_id, s.signer_order ASC`,
      stepIds
    );
    signers = sgn;
  }
  const stepsHydrated = steps.map(st => ({
    id: st.id,
    order: st.step_order,
    teamId: st.team_id,
    status: st.status,
    signers: signers.filter(s => s.step_id === st.id).map(s => ({
      id: s.id,
      order: s.signer_order,
      userId: s.user_id,
      userName: s.user_name,
      userEmail: s.user_email,
      page: s.page,
      x: Number(s.marker_x),
      y: Number(s.marker_y),
      w: Number(s.marker_w),
      h: Number(s.marker_h),
      rotation: Number(s.rotation || 0),
      status: s.status,
      signedAt: s.signed_at ? Number(s.signed_at) : null
    }))
  }));

  return {
    id: row.id,
    requestorId: row.requestor_id,
    requestorName: names[0]?.requestor_name || null,
    fileName: row.file_name,
    fileType: row.file_type,
    targetTeamId: row.target_team_id,
    marker: row.marker_json ? (typeof row.marker_json === "string" ? JSON.parse(row.marker_json) : row.marker_json) : null,
    note: row.note || "",
    status: row.status,
    createdAt: Number(row.created_at),
    approverId: row.approver_id,
    approverName: names[0]?.approver_name || null,
    approvedAt: row.approved_at ? Number(row.approved_at) : null,
    finalizedAt: row.finalized_at ? Number(row.finalized_at) : null,
    rejectedAt: row.rejected_at ? Number(row.rejected_at) : null,
    rejectReason: row.reject_reason,
    hasSignedFile: !!row.signed_file_path,
    reminders: rems.map(r => Number(r.sent_at)),
    requestType: row.request_type || "general",
    instantApproval: !!row.instant_approval,
    currentStep: Number(row.current_step || 0),
    workflow: stepsHydrated
  };
}
