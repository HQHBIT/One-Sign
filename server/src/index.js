import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { initDb } from "./db.js";
import { startScheduler } from "./scheduler.js";

import authRoutes from "./routes/auth.js";
import usersRoutes from "./routes/users.js";
import teamsRoutes from "./routes/teams.js";
import requestsRoutes from "./routes/requests.js";
import adminRoutes from "./routes/admin.js";
import registrationsRoutes from "./routes/registrations.js";
import passwordResetsRoutes from "./routes/password-resets.js";
// import expensesRoutes from "./routes/expenses.js"; // DISABLED: expense feature commented out

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = path.resolve(__dirname, "../../client/dist");

const PORT = parseInt(process.env.PORT || "5001", 10);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";

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
  app.use(cors({ origin: CLIENT_ORIGIN, credentials: false }));
  app.use(express.json({ limit: "5mb" }));
  app.use(express.urlencoded({ extended: true, limit: "5mb" }));

  app.get("/api/health", (req, res) => res.json({ ok: true, time: Date.now() }));

  app.use("/api/auth", authRoutes);
  app.use("/api/users", usersRoutes);
  app.use("/api/teams", teamsRoutes);
  app.use("/api/requests", requestsRoutes);
  // app.use("/api/expenses", expensesRoutes); // DISABLED: expense feature commented out
  app.use("/api/registrations", registrationsRoutes);
  app.use("/api/password-resets", passwordResetsRoutes);
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
    console.error("[error]", err);
    if (res.headersSent) return next(err);
    res.status(err.status || 500).json({ error: err.message || "Server error" });
  });

  app.listen(PORT, () => {
    const banner = [
      "",
      "╔══════════════════════════════════════════════════════════╗",
      "║           HQHB · SignFlow · API server (MySQL)           ║",
      "╚══════════════════════════════════════════════════════════╝",
      `  ▸ http://localhost:${PORT}/api`,
      `  ▸ CORS origin: ${CLIENT_ORIGIN}`,
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
