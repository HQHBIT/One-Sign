// ============================================================
//   Lint gate — page-blanking bugs only.
//   ------------------------------------------------------------
//   Vite does not check that identifiers exist: `user={user}` with no `user`
//   in scope, or <ChevronUp/> without its import, builds cleanly and then
//   throws a ReferenceError at runtime — React unmounts, and the user gets a
//   blank screen. Both have now happened in production.
//
//   This config enforces exactly two rules, so it stays silent until something
//   would actually crash a page:
//     no-undef             — any bare identifier that is not declared
//     react/jsx-no-undef   — any <Component/> that is not imported/declared
//
//   Runs as `prebuild`, so `npm run build` — locally and in the deploy
//   workflow — fails BEFORE a broken bundle can ship.
// ============================================================
import globals from "globals";
import react from "eslint-plugin-react";

export default [
  {
    files: ["src/**/*.{js,jsx,mjs}"],
    plugins: { react },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        ...globals.browser,
        // Node-flavoured helpers that appear in browser code via Vite polyfills
        // or test files run under Node.
        process: "readonly",
        Buffer: "readonly",
        // Compile-time constant injected by Vite's `define` (vite.config.js).
        __BUILD_ID__: "readonly",
      },
    },
    settings: { react: { version: "detect" } },
    rules: {
      "no-undef": "error",
      "react/jsx-no-undef": "error",
    },
  },
];
