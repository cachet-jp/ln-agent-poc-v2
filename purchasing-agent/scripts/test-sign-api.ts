/**
 * Test sign-intent/sign and sign-batch directly against CLW API.
 */
import dotenv from "dotenv";
dotenv.config();

const BASE = process.env.CLW_API_BASE_URL!;
const TOKEN = process.env.CLW_SESSION_TOKEN!;
const ID = process.env.CLW_IDENTITY_ID!;

console.log("Identity:", ID);
console.log("Token (first 50):", TOKEN.substring(0, 50) + "...");

// Test digest
const testDigest =
  "0000000000000000000000000000000000000000000000000000000000000001";

async function testSignIntent() {
  console.log("\n=== Testing sign-intent ===");
  const res = await fetch(`${BASE}/v1/identities/${ID}/sign-intent`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ digest: testDigest }),
  });
  const text = await res.text();
  console.log("Status:", res.status);
  console.log("Body:", text);

  if (res.ok) {
    const intent = JSON.parse(text);
    console.log("\n=== Testing sign (with ticket) ===");
    const signRes = await fetch(`${BASE}/v1/identities/${ID}/sign`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${TOKEN}`,
      },
      body: JSON.stringify({ digest: testDigest, ticket: intent.ticket }),
    });
    const signText = await signRes.text();
    console.log("Status:", signRes.status);
    console.log("Body:", signText);
  }
}

async function testSignBatch() {
  console.log("\n=== Testing sign-batch ===");
  const res = await fetch(`${BASE}/v1/identities/${ID}/sign-batch`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({ digests: [{ digest: testDigest }] }),
  });
  const text = await res.text();
  console.log("Status:", res.status);
  console.log("Body:", text);
}

async function main() {
  await testSignIntent();
  await testSignBatch();
}

main().catch(console.error);
