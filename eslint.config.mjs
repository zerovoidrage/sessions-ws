/** @type {import("eslint").Linter.Config[]} */
export default [
  {
    ignores: [".next/**", "node_modules/**", "dist/**"],
  },
  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    rules: {
      // Базовые правила Next.js
      "@next/next/no-html-link-for-pages": "error",
      "@next/next/no-img-element": "warn",
      "react/no-unescaped-entities": "warn",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
];

