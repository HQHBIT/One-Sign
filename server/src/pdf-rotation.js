// Pure rotation helpers used by the server's bake step. Marker coordinates are
// top-down MediaBox % with x to the right and y downward; w/h are widths/heights
// in %. A 90° clockwise rotation of the *page* maps a marker at (x, y) on the
// pre-rotation page to (100 - y - h, x) on the post-rotation page, with w and h
// swapping. (Same math as the existing viewportToMediabox helper in App.jsx.)

export function orientationOf({ width, height }) {
  return width > height ? "landscape" : "portrait";
}

export function rotateMarker90CW({ x, y, w, h }) {
  return { x: 100 - y - h, y: x, w: h, h: w };
}

// For each page dimensions object, returns 0 (leave as-is) or 90 (rotate CW)
// to reach the target orientation. Callers iterate pages in order.
export function bakeOrientationPlan(pageDims, targetOrientation) {
  return pageDims.map(d => orientationOf(d) === targetOrientation ? 0 : 90);
}
