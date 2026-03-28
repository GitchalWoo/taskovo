import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier";

export default tseslint.config(
  {
    ignores: ["node_modules/", "dist/", "out/", "state/", "data/"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strict,
  eslintConfigPrettier,
  {
    rules: {
      // Unused vars: allow underscore-prefixed (e.g., _timezone)
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      // Allow non-null assertions — used intentionally (e.g., t.due!)
      "@typescript-eslint/no-non-null-assertion": "off",
      // Enforce === everywhere
      eqeqeq: ["error", "always"],
    },
  },
  {
    // Scripts are exploratory — relax rules
    files: ["scripts/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },
);
