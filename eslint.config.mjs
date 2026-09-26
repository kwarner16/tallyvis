import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/.turbo/**", "**/coverage/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // Manually-run Node scripts (e.g. services/ai/scripts — the 2026-09
    // "obvious window" incident's diagnostic/verification scripts, docs/
    // decisions/0025) run directly under `node`/`tsx`, never bundled or
    // type-checked as part of a package's own build — they need Node's
    // own globals declared explicitly, unlike every other file here.
    files: ["**/scripts/**/*.mjs"],
    languageOptions: {
      globals: { process: "readonly", console: "readonly", Buffer: "readonly" },
    },
  },
);
