// HQHB: the requestor takes a copy out of SignFlow (Download / Print) only once
// EVERY signer has signed (owner, 2026-11-02) — a partly signed document is not
// the document, and handing it round mid-route invites it being used as one.
// Approvers keep their download: they may take a paper away to read before
// they sign. The server refuses the same download independently.
import { isHqhbBox } from "./deployment.js";

export function requestorMustWait(req, user) {
  return isHqhbBox() && !!user && req?.requestorId === user.id && req?.status !== "approved";
}

export const WAIT_TITLE = "Available once every signer has signed";
