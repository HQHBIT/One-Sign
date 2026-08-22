# Multi-organisation SignFlow — design

**Date:** 2026-08-22
**Status:** approved in outline; two items pending confirmation (see Open items)

## Problem

SignFlow serves one organisation, HQHB. A second, the Waqf & Trust Department, is
being onboarded. It needs its own space with its own people, and the two must not
bleed into each other: a HQHB account must not be able to sign in to the Waqf
space, or vice versa.

But the organisations are not wholly separate. Some individuals must be able to
approve documents in the *other* organisation, so an inter-departmental sign-off
can happen without giving that person the run of the other space.

Three schema facts shape everything below:

| Fact | Consequence |
|---|---|
| `teams.name` is globally `UNIQUE` | Only one "IT" can exist today |
| `users.email` is globally `UNIQUE` | A person is one row, never two |
| `signing_authority(user_id, team_id)` is many-to-many | Cross-org approval needs no new join table |

## Decisions taken

1. **Waqf authenticates with local email + password only.** No SSO for that
   organisation. oneAccess stays HQHB-only, so there is no shared directory and
   isolation does not depend on getting an SSO gate right.
2. **A Global User is an approver elsewhere and nothing else.** They appear in the
   other organisation's approver picker and sign what is routed to them, from
   their own login. They never sign in to the other space and cannot browse its
   users, teams or unrelated requests.
3. **Organisation is a column, not a naming convention.** `teams.org_id` with
   `UNIQUE(org_id, name)`, rendered as "HQHB — IT". Encoding the organisation into
   the name string works only while everyone types it identically.
4. **Approvers get a department filter, not a second report.** Chips beside the
   existing request-type filters on their queues. The admin department report is
   not duplicated.

## Data model

```
organisations   id, slug, name, logo_path, allow_oneaccess, allow_local,
                active, created_at
users           + org_id      -- home organisation
                + is_global   -- selectable as approver in other organisations
teams           + org_id;  UNIQUE(name) becomes UNIQUE(org_id, name)
requests        + org_id      -- denormalised from the requestor, for filtering
```

Migration backfills every existing user, team and request to HQHB, so behaviour is
unchanged on the day it ships. `requests.org_id` is denormalised deliberately: it
is derivable from the requestor, but every list query filters on it and the join
is not worth paying repeatedly.

## Landing and login

The landing page presents one tile per active organisation — logo, name, click to
proceed. The choice is stored in `localStorage` with a visible way to switch, so
returning users go straight to their login.

`/api/auth/config` becomes organisation-aware and returns that organisation's
permitted methods: HQHB gets oneAccess plus local, Waqf gets local only.

Local login carries the organisation slug. The server loads the account, compares
`org_id`, and on mismatch returns **the same generic "Invalid email or password"**
used for a wrong password. A specific "wrong organisation" message would confirm
that the address exists in the other organisation, which is exactly the
enumeration the existing anti-enumeration handling avoids elsewhere.

oneAccess start and callback remain HQHB-only. An SSO login can therefore never
land a user in the Waqf space, whatever slug is in play.

## Global approvers

`users.is_global` is an administrator toggle.

Approver selection — `/users/search` and the pickers in the request builder —
returns *users in the current organisation, plus global users from any
organisation*. `signing_authority` is unchanged: an administrator may grant a
global HQHB user authority over a Waqf team and the existing signing machinery
works untouched.

The subtle part is request visibility. A global user's pending queue must include
the other organisation's requests they are a signer on. Those rows already arrive
through the existing participation clauses (`r.approver_id = ?`, `sg.user_id = ?`)
in `GET /requests`. **The new organisation filter must therefore be written so it
does not exclude them** — organisation scoping applies to browsing, not to
participation. Everything else stays hard-scoped to their home organisation.

## Departments

`teams.org_id` is added and teams render organisation-prefixed. The oneAccess
department-to-team resolution in `routes/auth.js` is scoped to HQHB so an SSO
department string can never resolve onto a Waqf team.

Approver queues gain a department chip row beside the existing request-type chips.

## Isolation invariants

These are the queries where a mistake leaks data across organisations:

| Query | Rule |
|---|---|
| `GET /users` (admin list) | organisation filter, unless the admin is global |
| `GET /users/search` | current organisation **plus global users** |
| `GET /teams` | current organisation only |
| `GET /requests` | participation as today; the team-authority clause also checks organisation |
| Reports / analytics | current organisation only |

Each gets a test asserting a user of one organisation cannot see the other's rows.

## Phases

1. **Organisation model, backfill, isolation.** No visible change; everything is
   HQHB.
2. **Landing picker, per-organisation login config, cross-organisation refusal.**
3. **Global users and cross-organisation approver selection.**
4. **Department filter on approver queues.**

Each deploys and rolls back independently. Phase 2 without phase 1 would be a
facade — a picker that gates nothing — so they ship in order.

## Open items

- **Is the existing IT Admin global?** The design assumes one administrator
  managing both organisations. If each organisation needs its own administrator
  who cannot see the other, every admin query changes.
- **Waqf display name and slug.** Proposed: name "Waqf & Trust Department", slug
  `waqf`. HQHB keeps slug `hqhb`.
- **Logo assets.** HQHB's mark exists at `client/public/email/qh-logo.png` but at
  128×127 it is too small for a landing tile and will look soft on a high-density
  screen. The Waqf mark is not in the repository at all. Both are needed at 512px
  or larger, or as SVG.

## Out of scope

Per-organisation branding beyond the logo (colours, email templates). Separate
deployments or hostnames per organisation — this stays one application. Migrating
existing HQHB data anywhere.
