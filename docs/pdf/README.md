# Pre-built PDFs

The `.pdf` files in this folder are generated from the `.md` files in `docs/`.
They use the HQHB SignFlow brand palette (navy ink, gold accent, cream paper)
and are styled with the same typography as the app itself (Fraunces + IBM Plex).

## Files

| File | Source | Pages | Audience |
|------|--------|-------|----------|
| `user-guide.pdf` | `docs/user-guide.md` | 8 | All users — attach to launch email |
| `quickref.pdf` | `docs/quickref.md` | 2-3 | All users — pinnable cheat sheet |
| `admin-handbook.pdf` | `docs/admin-handbook.md` | 12+ | IT Admin reference |
| `faq.pdf` | `docs/faq.md` | 5-6 | All users — common questions |
| `launch-announcement.pdf` | `docs/launch-announcement.md` | 4-5 | Distribution templates |
| `onboarding-checklist.pdf` | `docs/onboarding-checklist.md` | 4-5 | IT Admin rollout plan |
| `README.pdf` | `docs/README.md` | 1 | Index |

## Regenerating after a markdown edit

If you update any `.md` file in `docs/`, the PDFs go stale. Rebuild:

```bash
cd scripts
npm install        # only the first time
node build-docs-pdf.cjs
```

The script:
- Parses each `.md` with `marked`
- Wraps it in a HTML shell with the brand stylesheet (matches `client/src/components/StyleTag.jsx`)
- Renders to PDF via Puppeteer (Chromium)
- Saves to `docs/pdf/<name>.pdf` with cover header, footer with page numbers, and 18 mm margins

A clean rebuild takes ~10 seconds for all 7 docs.

## Email distribution

For the beta launch announcement, attach:
- `user-guide.pdf`
- `quickref.pdf`

That's enough for any user to get started.
