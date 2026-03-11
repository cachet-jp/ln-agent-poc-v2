/**
 * Test script to find and load TreeSignerSession via the same mechanism
 * we'll use in remoteSignerIdentity.ts
 */
import { createRequire } from "node:module";
import path from "node:path";

const require2 = createRequire(import.meta.url);

// Step 1: Find SDK root by resolving its main entry
console.log("=== Step 1: Locate SDK ===");
// @clw-cash/sdk links to ../claw-cash/remote-signer-identity
// which has @arkade-os/sdk as a dependency
// Let's find the SDK from claw-cash/skills which has it too
try {
  // The skill package resolves @arkade-os/sdk
  const skillsPath = require2.resolve("@clw-cash/skills");
  console.log("Skills resolved to:", skillsPath);

  // From skills, we can find the @arkade-os/sdk
  const skillsRequire = createRequire(skillsPath);
  const sdkMainPath = skillsRequire.resolve("@arkade-os/sdk");
  console.log("SDK main resolved to:", sdkMainPath);

  // Navigate to the signingSession file
  const sdkDir = sdkMainPath.replace(/\/dist\/(cjs|esm)\/index\.js$/, "");
  console.log("SDK root:", sdkDir);

  const signingSessionPath = path.join(sdkDir, "dist", "cjs", "tree", "signingSession.js");
  console.log("SigningSession path:", signingSessionPath);

  // Load it directly using require (bypasses exports field)
  const mod = skillsRequire(signingSessionPath);
  console.log("\n=== Step 2: Module contents ===");
  console.log("Keys:", Object.keys(mod));
  console.log("TreeSignerSession type:", typeof mod.TreeSignerSession);

  if (mod.TreeSignerSession) {
    console.log("Has random():", typeof mod.TreeSignerSession.random);

    console.log("\n=== Step 3: Create session ===");
    const session = mod.TreeSignerSession.random();
    console.log("Session created:", !!session);
    console.log("Session has getPublicKey:", typeof session.getPublicKey);
    console.log("Session has init:", typeof session.init);
    console.log("Session has getNonces:", typeof session.getNonces);
    console.log("Session has sign:", typeof session.sign);
    console.log("\nSUCCESS! TreeSignerSession loaded and working.");
  }
} catch (e: any) {
  console.error("Error:", e.message);
  console.error("Stack:", e.stack);
}
