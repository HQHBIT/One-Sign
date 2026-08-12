import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { initDb } from "./db.js";
import { startScheduler } from "./scheduler.js";

import authRoutes from "./routes/auth.js";
import webauthnRoutes from "./routes/webauthn.js";
import notificationsRoutes from "./routes/notifications.js";
import eventsRoutes from "./events.js";
import workflowTemplatesRoutes from "./routes/workflow-templates.js";
import usersRoutes from "./routes/users.js";
import teamsRoutes from "./routes/teams.js";
import requestsRoutes from "./routes/requests.js";
import adminRoutes from "./routes/admin.js";
import registrationsRoutes from "./routes/registrations.js";
import passwordResetsRoutes from "./routes/password-resets.js";
import executiveAssistantsRoutes from "./routes/executive-assistants.js";
import assistRoutes from "./routes/assist.js";
import emailApproveRoutes from "./routes/email-approve.js";
// import expensesRoutes from "./routes/expenses.js"; // DISABLED: expense feature commented out

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = path.resolve(__dirname, "../../client/dist");

const PORT = parseInt(process.env.PORT || "5001", 10);
// Allowed browser origins. The public site is always allowed; CLIENT_ORIGIN adds
// the dev origin (or any extra) via env. This replaces echoing a single
// hard-configured value — which on prod had been the box's internal IP,
// leaking it in every CORS header.
const PUBLIC_ORIGIN = "https://signflow.umooriqtesadiyah.org";
const ALLOWED_ORIGINS = new Set([
  PUBLIC_ORIGIN,
  process.env.CLIENT_ORIGIN || "http://localhost:5173",
]);

async function main() {
  try {
    await initDb();
  } catch (e) {
    console.error("\n[FATAL] Could not connect to MySQL:", e.message);
    console.error("  Verify DB_HOST / DB_PORT / DB_USER / DB_PASSWORD in your .env file,");
    console.error("  and that the MySQL server is running and reachable.\n");
    process.exit(1);
  }

  const app = express();
  // One front proxy (nginx/Cloudflare) sits ahead of us, so trust exactly one
  // hop — this makes req.ip the real client for rate limiting without letting a
  // client forge X-Forwarded-For to dodge it.
  app.set("trust proxy", 1);
  // Don't advertise the framework.
  app.disable("x-powered-by");

  // Security headers on every response. No external dependency; conservative so
  // nothing breaks. (CSP is deliberately omitted — a wrong policy would break
  // the SPA; nginx is the right place for it once tuned.)
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    next();
  });

  app.use(cors({
    // Reflect only known origins; never emit the server's own address.
    origin: (origin, cb) => cb(null, !origin || ALLOWED_ORIGINS.has(origin) ? (origin || PUBLIC_ORIGIN) : false),
    credentials: false,
  }));
  app.use(express.json({ limit: "5mb" }));
  app.use(express.urlencoded({ extended: true, limit: "5mb" }));

  app.get("/api/health", (req, res) => res.json({ ok: true, time: Date.now() }));

  app.use("/api/auth", authRoutes);
  app.use("/api/webauthn", webauthnRoutes);
  app.use("/api/notifications", notificationsRoutes);
  app.use("/api/events", eventsRoutes);
  app.use("/api/workflow-templates", workflowTemplatesRoutes);
  app.use("/api/users", usersRoutes);
  app.use("/api/teams", teamsRoutes);
  app.use("/api/requests", requestsRoutes);
  // app.use("/api/expenses", expensesRoutes); // DISABLED: expense feature commented out
  app.use("/api/registrations", registrationsRoutes);
  app.use("/api/password-resets", passwordResetsRoutes);
  app.use("/api/executive-assistants", executiveAssistantsRoutes);
  app.use("/api/assist", assistRoutes);
  app.use("/api/email-approve", emailApproveRoutes);
  app.use("/api", adminRoutes);

  // Serve built client assets in production
  if (fs.existsSync(CLIENT_DIST)) {
    app.use(express.static(CLIENT_DIST, {
      setHeaders(res, filePath) {
        if (filePath.endsWith(".mjs")) {
          res.setHeader("Content-Type", "application/javascript");
        }
      }
    }));
    // SPA fallback — non-API requests serve index.html
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.sendFile(path.join(CLIENT_DIST, "index.html"));
    });
  }

  app.use((err, req, res, next) => {
    console.error("[error]", err);          // full detail stays server-side
    if (res.headersSent) return next(err);
    const status = err.status || 500;
    // Only deliberate 4xx errors (thrown with a .status) may show their message.
    // An unexpected 500 returns a generic string so raw library errors — SQL
    // bind failures, type crashes — never reach the client.
    const body = status < 500 && err.message ? err.message : "Something went wrong. Please try again.";
    res.status(status).json({ error: body });
  });

  app.listen(PORT, () => {
    const banner = [
      "",
      "╔══════════════════════════════════════════════════════════╗",
      "║           HQHB · SignFlow · API server (MySQL)           ║",
      "╚══════════════════════════════════════════════════════════╝",
      `  ▸ http://localhost:${PORT}/api`,
      `  ▸ CORS origins: ${[...ALLOWED_ORIGINS].join(", ")}`,
      `  ▸ SendGrid: ${process.env.SENDGRID_API_KEY ? "LIVE" : "logged only (set SENDGRID_API_KEY to enable)"}`,
      "",
      "  Seeded accounts:",
      "    admin     · it@hqhb.in / Taha@011023",
      "    requestor · mufaddal.safdari@hqhb.in / Mufaddal@1995",
      "    approver  · moiz.barwani@hqhb.in / Moiz@9207",
      ""
    ];
    console.log(banner.join("\n"));
    startScheduler();
  });
}

main();
