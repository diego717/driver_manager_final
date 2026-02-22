import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@\//,
        replacement: `${path.resolve(__dirname)}/`,
      },
      {
        find: /^react-native$/,
        replacement: "react-native-web",
      },
    ],
  },
  test: {
    server: {
      deps: {
        inline: [/^@testing-library\/react-native/, /^react-native/],
      },
    },
  },
});
