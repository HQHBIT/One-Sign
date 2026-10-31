# Files for Senior Executive Management

Date: 2026-10-31 · HQHB only · extends the EA Document flow (`ea-flow.js`)

## Ask (owner)

For the executive assistant, a tab in the Document flow called **Files for Senior
Executive Management**. Whenever any employee sends a document for signature to
one of the executives the assistant supports (Shabbar bs, Taikhoom Bs and Taha BS
for mohammed.dohadwala@hqhb.in), it appears there. From the tab the assistant
reviews the file, sees whom the employee asked, and routes it through the
Document flow, including sending it to another executive just to review.

## Decisions (owner)

- **Both at once.** The employee's request still reaches the executive exactly as
  today; the tab is the assistant's view of it, not a gate.
- **Routing = put it on a board.** The file becomes a card on one of the
  assistant's boards. From there every existing card feature applies: Review
  (send to read), CC stages, signing stages, drag/Move to, dashboard, CSV.

## Design

- **Who is covered.** The assistant's Delegation links with view access
  (`executive_assistants`, `can_view` or `can_dashboard`). Never a fixed list:
  linking or unlinking an executive changes the tab.
- **What is listed** (`GET /api/ea-flow/inbox`):
  - Pending, non-confidential requests on which a covered executive is a signer,
    using the same test as the executive tab (`assist.js`).
  - Requests raised by the assistant's own boards are left out; they are already
    cards.
  - Each item shows file, requestor, team, created date, every step and signer
    in order (the covered ones marked, whose turn it is), and whether it is
    already on one of the assistant's boards.
  - Names only, no email addresses.
- **Put on a board** (`POST /api/ea-flow/inbox/:requestId/board`):
  - Takes a board and a stage. The stage must not itself ask for a signature;
    asking another executive to sign means moving the card to a signing stage
    afterwards, where the box is placed as for any card.
  - The card keeps its own copy of the file and records `source_request_id`.
  - Only once per assistant (409 otherwise).
- **The card follows the employee's request.**
  - `docOut.source` gives requestor, steps, whose turn it is, and who has signed.
  - The card shows "From X · awaiting Y", then "signed by Y".
  - Opening it shows the signed copy once the executive signs
    (`currentBytes` falls back to the source request's signed file).
- **Client.**
  - `ExecInbox.jsx` is the first entry in the board row, and the Document flow
    opens on it.
  - It has filter chips per executive with counts, Open (preview), Put on a board
    (board and stage picker, with signing stages disabled and labelled), and a
    pill linking to the board and stage once placed.

## Tests

`ea-flow.integration.mjs` (145 checks; 12 new):
- An employee's request appears, with requestor, signers and whose turn it is.
- No email addresses.
- Board-raised requests and confidential requests are not listed.
- A signing stage is refused as the landing stage.
- Putting it on a board links the card to the request, and the card shows who
  sent it and who is awaited.
- Only once per assistant.
- The list shows the board and stage.
- The employee's request is untouched.
- Another assistant cannot use someone else's board.

Driven on the production build as the demo assistant: list, Open, Put on a
board, and the card on the board.

## Setup on live

The assistant must be linked (Delegation, "View documents") to every executive
the tab should cover.
