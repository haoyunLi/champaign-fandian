import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ['src/app/**/*.{ts,tsx}', 'src/components/replay-button.tsx'],
    rules: {
      // Room navigation uses popstate plus a query-string room ID. Full navigation
      // from other pages deliberately remounts that controller and its identity.
      '@next/next/no-html-link-for-pages': 'off',
      '@next/next/no-location-assign-relative-destination': 'off',
      // The single illustration is a fixed local asset, with explicit dimensions.
      '@next/next/no-img-element': 'off',
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    files: ["src/components/ui/**/*.{ts,tsx}", "src/hooks/use-mobile.ts"],
    rules: {
      // These files are vendored verbatim from shadcn@4.17.0. Keep the
      // registry source intact while applying the stricter rules to Site code.
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
