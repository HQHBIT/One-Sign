// ============================================================
//   ONE-TIME BACKGROUND CLEAN OF STORED SIGNATURES
//   ------------------------------------------------------------
//   Signatures saved before background removal existed have their paper baked
//   into the PNG, so they stamp as an opaque rectangle of someone's notebook
//   sitting on top of the document. Fixing new uploads does nothing for them —
//   the owner would have to notice and re-upload, which nobody does.
//
//   So on sign-in we look at each of the user's signatures once, and clean the
//   ones that still have their paper. This rewrites something the user did not
//   ask us to touch, so it is deliberately cautious:
//
//     * isOpaqueBackground only fires on a genuinely solid opaque border, so an
//       already-clean signature is never reprocessed.
//     * The server keeps the pre-clean file forever and exposes an undo.
//     * Every signature is inspected AT MOST ONCE. A failure marks it skipped
//       rather than retrying on every future sign-in.
//     * It runs detached from the sign-in path — a failure here must never
//       stop anyone getting into the app.
// ============================================================
import { api } from "../api.js";
import { cutoutSignature, imageDataOf, isOpaqueBackground, loadImage, SAVE_MAX_DIM } from "./signatureCutout.js";

// Once per page load at most, however many times the caller fires.
let ran = false;

/**
 * Cleans any of the signed-in user's stored signatures that still carry their
 * paper. Resolves to the number cleaned (0 when there was nothing to do).
 * Never rejects.
 */
export async function autoCleanStoredSignatures(notify) {
  if (ran) return 0;
  ran = true;

  // This pass is invisible, so when it declines to act it leaves no trace and
  // the signature simply stays dirty with no explanation. Log every decision:
  // it is the only evidence available when someone reports "it didn't work".
  const log = (sigId, decision, extra) =>
    console.info(`[signature-clean] ${sigId}: ${decision}`, extra ?? "");

  let cleaned = 0;
  try {
    const list = await api.mySignatures();
    const todo = list.filter(s => !s.bgCleaned);
    log("pass", `${list.length} signature(s), ${todo.length} not yet inspected`);

    for (const sig of todo) {
      let url = null;
      try {
        url = await api.mySignatureBlob(sig.id);
        if (!url) {
          log(sig.id, "skipped — image could not be fetched");
          await api.markSignatureBackground(sig.id, { skip: true });
          continue;
        }
        const img = await loadImage(url);

        // Inspect a small proxy — deciding whether the paper is still there
        // does not need full resolution.
        if (!isOpaqueBackground(imageDataOf(img, 400))) {
          log(sig.id, "skipped — background already transparent");
          await api.markSignatureBackground(sig.id, { skip: true });
          continue;
        }

        const result = await cutoutSignature(img, { maxDim: SAVE_MAX_DIM });
        // A cutout that removed essentially everything means the detection was
        // wrong for this image. Leave the original alone rather than replace a
        // usable signature with a blank one.
        if (!result.dataUrl || result.width < 8 || result.height < 4) {
          log(sig.id, "skipped — cutout came back empty", { w: result.width, h: result.height });
          await api.markSignatureBackground(sig.id, { skip: true });
          continue;
        }
        if (result.lowContrast) {
          log(sig.id, "skipped — ink and paper too close to separate safely");
          await api.markSignatureBackground(sig.id, { skip: true });
          continue;
        }

        await api.markSignatureBackground(sig.id, { dataUrl: result.dataUrl });
        log(sig.id, "cleaned", { w: result.width, h: result.height });
        cleaned++;
      } catch (e) {
        // Network trouble: leave the flag unset so it is retried next sign-in.
        // Anything else has already been marked skipped above.
        log(sig.id, "failed — will retry next sign-in", e?.message || e);
      } finally {
        if (url) URL.revokeObjectURL(url);
      }
    }
  } catch (e) {
    log("pass", "could not list signatures", e?.message || e);
    return 0; // try again next sign-in
  }

  if (cleaned && notify) {
    notify(
      cleaned === 1
        ? "Your saved signature had its paper background removed — see Manage signatures to review or undo it."
        : `${cleaned} saved signatures had their paper backgrounds removed — see Manage signatures to review or undo.`,
      "success"
    );
  }
  return cleaned;
}
