import { defineConfig } from "eslint/config"
import medusa from "@medusajs/eslint-plugin"

export default defineConfig([
  // Florayn Console build output (minified); its source in console/ is linted
  { ignores: ["console-dist/**"] },
  ...medusa.configs.recommended,
])
