import { defineConfig } from "vitest/config";
import path from "path";

const clawCashSkills = path.resolve(__dirname, "../claw-cash/skills/src/skills");

export default defineConfig({
  resolve: {
    alias: [
      // Map relative claw-cash imports (used to bypass broken lendaswap barrel)
      // to their absolute .ts paths so vite can resolve them.
      {
        find: /^\.\.\/\.\.\/claw-cash\/skills\/src\/skills\/(.+)\.js$/,
        replacement: `${clawCashSkills}/$1.ts`,
      },
    ],
  },
});
