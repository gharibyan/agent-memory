import js from "@eslint/js"
import tseslint from "typescript-eslint"

const nodeGlobals = {
  Buffer: "readonly",
  URL: "readonly",
  Response: "readonly",
  ReadableStream: "readonly",
  TextDecoder: "readonly",
  TextEncoder: "readonly",
  console: "readonly",
  fetch: "readonly",
  process: "readonly",
  structuredClone: "readonly"
}

export default tseslint.config(
  {
    ignores: [
      ".memory/**",
      ".ai-memory/**",
      "agent-memory-sdk-*.tgz",
      "coverage/**",
      "dist/**",
      "**/dist/**",
      "node_modules/**"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.{js,mjs,ts}"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: nodeGlobals
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_"
      }],
      "array-callback-return": "error",
      "curly": ["error", "multi-line"],
      "eqeqeq": ["error", "always"],
      "no-console": "off",
      "no-implicit-coercion": "error",
      "no-undef": "off",
      "no-unused-vars": "off",
      "no-var": "error",
      "object-shorthand": "error",
      "prefer-const": "error",
      "quotes": ["error", "double", { avoidEscape: true }],
      "semi": ["error", "never"]
    }
  }
)
