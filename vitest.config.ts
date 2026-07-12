import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      // Тот же alias, что в tsconfig ("@/*" → "./*").
      "@": root,
      // server-only бросает исключение при импорте вне RSC — в тестах
      // подменяем пустым модулем.
      "server-only": path.join(root, "test/stubs/empty.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**"],
  },
});
