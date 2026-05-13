import test from "node:test";
import assert from "node:assert/strict";
import {
  orientationOf,
  rotateMarker90CW,
  bakeOrientationPlan
} from "../src/pdf-rotation.js";

test("orientationOf returns 'landscape' when width > height", () => {
  assert.equal(orientationOf({ width: 800, height: 600 }), "landscape");
});

test("orientationOf returns 'portrait' when height >= width", () => {
  assert.equal(orientationOf({ width: 600, height: 800 }), "portrait");
  assert.equal(orientationOf({ width: 600, height: 600 }), "portrait");
});

test("rotateMarker90CW maps top-left corner to right edge", () => {
  // Marker at (x=10, y=20, w=10, h=5) in top-down %.
  // After 90° CW on the page: the marker's pre-rotation top-left ends up at
  // post-rotation (x=80, y=10). w/h swap.
  const r = rotateMarker90CW({ x: 10, y: 20, w: 10, h: 5 });
  assert.deepEqual(r, { x: 75, y: 10, w: 5, h: 10 });
});

test("rotateMarker90CW applied four times returns to identity", () => {
  let m = { x: 10, y: 20, w: 10, h: 5 };
  const orig = { ...m };
  for (let i = 0; i < 4; i++) m = rotateMarker90CW(m);
  assert.deepEqual(m, orig);
});

test("bakeOrientationPlan keeps pages already in target orientation", () => {
  const pages = [{ width: 600, height: 800 }, { width: 600, height: 800 }];
  const plan = bakeOrientationPlan(pages, "portrait");
  assert.deepEqual(plan, [0, 0]);
});

test("bakeOrientationPlan rotates pages whose orientation differs", () => {
  const pages = [
    { width: 600, height: 800 }, // portrait
    { width: 800, height: 600 }  // landscape
  ];
  assert.deepEqual(bakeOrientationPlan(pages, "portrait"),  [0,  90]);
  assert.deepEqual(bakeOrientationPlan(pages, "landscape"), [90, 0]);
});
