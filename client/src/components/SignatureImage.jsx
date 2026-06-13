import { useState, useEffect } from "react";
import { PenTool } from "lucide-react";
import { api } from "../api.js";

export function SignatureImage({ userId, height = 34, maxWidth = 140 }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let u = null;
    (async () => { u = await api.getSignatureBlob(userId); setUrl(u); })();
    return () => { if (u) URL.revokeObjectURL(u); };
  }, [userId]);
  if (!url) return <span className="inline-block opacity-40"><PenTool size={12} /></span>;
  return <img src={url} alt="signature" style={{ height, maxWidth, objectFit: "contain" }} />;
}
