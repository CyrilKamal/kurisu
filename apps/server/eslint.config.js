import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

// Every model call goes through one provider interface; SDKs live only there.
const MODEL_SDK_ALLOWED = ["src/llm/providers/**"];
const modelSdks = {
  group: ["@google/genai", "@google/genai/*", "ollama", "openai", "@anthropic-ai/*"],
  message:
    "Model SDKs may only be imported in src/llm/providers/. Use the ModelClient from src/llm/.",
};

// Nothing writes to MAL except commit_update (src/writes/commit.ts).
const MAL_WRITE_ALLOWED = ["src/writes/commit.ts", "src/mal/writeClient.ts"];
const malWriteClient = {
  group: ["**/mal/writeClient.js", "**/writeClient.js"],
  message: "Only src/writes/commit.ts may write to MAL. Propose a change and commit it instead.",
};

export default defineConfig([
  globalIgnores(["dist/**", "coverage/**"]),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: { allowDefaultProject: ["eslint.config.js"] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["**/*.js"],
    extends: [tseslint.configs.disableTypeChecked],
  },
  // CLAUDE.md hard rules, enforced on imports. A file gets exactly one no-restricted-imports
  // config (later blocks replace earlier ones), so each block lists every rule that applies.
  {
    files: ["**/*.ts"],
    ignores: [...MODEL_SDK_ALLOWED, ...MAL_WRITE_ALLOWED],
    rules: { "no-restricted-imports": ["error", { patterns: [modelSdks, malWriteClient] }] },
  },
  {
    files: MODEL_SDK_ALLOWED,
    rules: { "no-restricted-imports": ["error", { patterns: [malWriteClient] }] },
  },
  {
    files: MAL_WRITE_ALLOWED,
    rules: { "no-restricted-imports": ["error", { patterns: [modelSdks] }] },
  },
  prettier,
]);
