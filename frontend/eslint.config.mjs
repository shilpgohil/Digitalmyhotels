import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

// Inline eslint-disable comments in this app are limited to two families:
//   1. @next/next/no-img-element — blob/object URLs and auth-header image
//      fetches cannot use next/image (no static src, no optimizer).
//   2. react-hooks/exhaustive-deps — URL-sync / restore effects that
//      intentionally omit `router` (stable) so they don't loop. Each
//      suppression must say *which* dep is omitted and why.
const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;
