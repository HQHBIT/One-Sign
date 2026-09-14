// A minimal S3-compatible object store, in process, for tests.
//
// Enough of the protocol for what the filestore does — PUT, GET, HEAD and
// DELETE of a single object, path-style — so the bucket half of the storage
// layer can be exercised on a machine with no bucket and no credentials. What is
// under test is the application's behaviour when a file lives only in the
// bucket, not Amazon's implementation of S3, so nothing beyond that is modelled.
import http from "node:http";
import crypto from "node:crypto";

export async function startFakeS3({ bucket = "test-bucket" } = {}) {
  const objects = new Map();          // key -> { body, type }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (parts[0] !== bucket) { res.writeHead(404); return res.end(); }
    const key = parts.slice(1).join("/");

    if (req.method === "PUT") {
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks);
        objects.set(key, { body, type: req.headers["content-type"] || "application/octet-stream" });
        res.writeHead(200, { ETag: `"${crypto.createHash("md5").update(body).digest("hex")}"` });
        res.end();
      });
      return;
    }
    const obj = objects.get(key);
    if (req.method === "DELETE") { objects.delete(key); res.writeHead(204); return res.end(); }
    if (!obj) {
      res.writeHead(404, { "Content-Type": "application/xml" });
      return res.end(req.method === "HEAD" ? undefined : "<Error><Code>NoSuchKey</Code></Error>");
    }
    const headers = {
      "Content-Type": obj.type,
      "Content-Length": obj.body.length,
      ETag: `"${crypto.createHash("md5").update(obj.body).digest("hex")}"`,
    };
    res.writeHead(200, headers);
    res.end(req.method === "HEAD" ? undefined : obj.body);
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    bucket,
    endpoint: `http://127.0.0.1:${port}`,
    objects,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
