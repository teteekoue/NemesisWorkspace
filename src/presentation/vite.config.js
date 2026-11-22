import { defineConfig } from "vite";
import puterLocalhost from "../../dev/puter-localhost.mjs";
import nemesisShared from "../../dev/nemesis-shared.mjs";
export default defineConfig({
  plugins: [nemesisShared(), puterLocalhost("presentation")],
  base: "./",
  test: { include: ["tests/**/*.test.js", "lib/**/*.test.ts"] },
});
