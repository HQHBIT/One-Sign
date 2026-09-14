// Is object storage considered configured, and against which service?
//
//   node test/storageConfig.test.mjs
//
// No network, no bucket. What is under test is the decision the module makes
// from its environment, which is the part that silently disabled storage when a
// box was pointed at Amazon S3: an endpoint is how you reach a SELF-HOSTED
// server, and its absence is precisely what selects AWS. Requiring it meant a
// complete-looking AWS configuration turned uploads back to the filesystem
// without saying so — the kind of fault nobody notices until the disk is the
// only copy.
const pass = [], fail = [];
const ck = (ok, label) => (ok ? pass : fail).push(label);

// Fresh module each time: the config is read once at import.
const load = async (env) => {
  for (const k of Object.keys(process.env)) if (k.startsWith("STORAGE_")) delete process.env[k];
  Object.assign(process.env, env);
  return import("../src/storage.js?" + Math.random());
};

// ---- Amazon S3: a bucket and a region, and deliberately no endpoint ----
{
  const s = await load({ STORAGE_BUCKET: "signflow-prod", STORAGE_REGION: "ap-south-1" });
  ck(s.isEnabled(), "a bucket with no endpoint is Amazon S3, and counts as configured");
  const st = s.status();
  ck(st.endpoint === null, "and reports no endpoint");
  ck(st.bucket === "signflow-prod", "naming the bucket");
}

// ---- a self-hosted server: bucket and endpoint ----
{
  const s = await load({
    STORAGE_BUCKET: "signflow-uat",
    STORAGE_ENDPOINT: "https://uat-s3.example.org",
    STORAGE_FORCE_PATH_STYLE: "true",
  });
  ck(s.isEnabled(), "a bucket with an endpoint is a self-hosted server, and counts too");
  ck(s.status().forcePathStyle === true, "path-style addressing is carried through");
}

// ---- not configured ----
{
  ck(!(await load({})).isEnabled(), "nothing set is not configured");
  ck(!(await load({ STORAGE_ENDPOINT: "https://uat-s3.example.org" })).isEnabled(),
    "an endpoint with no bucket is not configured — there is nowhere to put anything");
  ck(!(await load({ STORAGE_BUCKET: "   " })).isEnabled(), "a blank bucket is not a bucket");
}

// ---- the secret never leaves ----
// status() feeds an admin diagnostic, so it says whether credentials exist and
// never what they are.
{
  const s = await load({
    STORAGE_BUCKET: "b", STORAGE_ACCESS_KEY: "AKIAEXAMPLE", STORAGE_SECRET_KEY: "s3cr3t",
  });
  const json = JSON.stringify(s.status());
  ck(!json.includes("s3cr3t"), "the secret is not in the diagnostic");
  ck(!json.includes("AKIAEXAMPLE"), "nor the access key");
  ck(/configured/.test(json), "only that credentials are present");
}

for (const p of pass) console.log("  PASS  " + p);
for (const f of fail) console.log("  FAIL  " + f);
console.log(`\n  ${pass.length} passed, ${fail.length} failed\n`);
process.exit(fail.length ? 1 : 0);
