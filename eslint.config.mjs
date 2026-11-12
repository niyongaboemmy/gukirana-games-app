// Shared flat config for the whole monorepo (ESLint 9).
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

const noMathRandom = {
  "no-restricted-properties": [
    "error",
    {
      object: "Math",
      property: "random",
      message: "Use @gukirana/fairness for all randomness in game, money and matchmaking code (plan §4.4).",
    },
  ],
};

const noFloatHelpers = {
  "no-restricted-globals": ["error", { name: "parseFloat", message: "Money is integer-only (plan §4.3)." }],
  "no-restricted-syntax": [
    "error",
    { selector: "CallExpression[callee.property.name='toFixed']", message: "Money is integer-only (plan §4.3)." },
  ],
};

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/next-env.d.ts",
      "crates/**",
      "packages/games/pool/wasm/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/consistent-type-imports": "warn",
    },
  },
  {
    // NestJS DI reads constructor parameter types at runtime (emitDecoratorMetadata):
    // converting those imports to `import type` would break injection.
    files: ["apps/api/**/*.ts"],
    rules: { "@typescript-eslint/consistent-type-imports": "off" },
  },
  {
    files: [
      "packages/money/**/*.ts",
      "packages/fairness/**/*.ts",
      "packages/game-kit/**/*.ts",
      "packages/games/**/*.ts",
      "apps/api/src/modules/{ledger,wallet,payments,games,matchmaking,challenges}/**/*.ts",
      "apps/realtime/src/**/*.ts",
    ],
    rules: noMathRandom,
  },
  {
    files: ["packages/money/**/*.ts", "apps/api/src/modules/{ledger,wallet,payments}/**/*.ts"],
    rules: noFloatHelpers,
  },
);
