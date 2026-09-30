import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

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
  {
    // CLAUDE.md: every model call goes through one provider interface. SDKs live only there.
    files: ["**/*.ts"],
    ignores: ["src/llm/providers/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@google/genai", "@google/genai/*", "ollama", "openai", "@anthropic-ai/*"],
              message:
                "Model SDKs may only be imported in src/llm/providers/. Use the ModelClient from src/llm/.",
            },
          ],
        },
      ],
    },
  },
  prettier,
]);
