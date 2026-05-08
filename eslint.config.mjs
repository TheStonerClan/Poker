import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Parallel-track sub-packages — they have their own lint configs.
    "lib/recurrence/**",
    "lib/prize-math/**",
    "lib/color-up/**",
    "lib/uht-import/**",
    "scripts/signal-cli/proxy/**",
  ]),
]);

export default eslintConfig;
