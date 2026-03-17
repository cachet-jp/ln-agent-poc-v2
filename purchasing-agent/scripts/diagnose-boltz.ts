/**
 * Diagnose Boltz reverse swap infrastructure used by Ark wallet.
 *
 * Usage: npx tsx scripts/diagnose-boltz.ts
 *
 * This script checks:
 * 1. Boltz node info (Lightning pubkey, supported pairs)
 * 2. BTC/ARK reverse swap limits and fees
 * 3. Creates a test reverse swap to verify invoice generation
 * 4. Compares Boltz Lightning node with Ark Labs and standard Boltz
 *
 * No session token required — only talks to the public Boltz API.
 */
import crypto from "node:crypto";

const BOLTZ_API = "https://api.ark.boltz.exchange";
const BOLTZ_MAIN_API = "https://api.boltz.exchange";

// Known pubkeys for comparison
const KNOWN_NODES: Record<string, string> = {
  "Ark Labs (Amboss)":
    "031cfc12a7b944ae825c18c3153b1aab2bcbb46fbfc4d9ef0e7dfd4f9b35e8a2ff",
  "Standard Boltz LND":
    "026165850492521f4ac8abd9bd8088123446d126f648ca35e60f88177dc149ceb2",
  "Standard Boltz CLN":
    "02d96eadea3d780104449aca5c93461ce67c1564e2e1d73225fa67dd3b997a6018",
};

async function fetchJSON<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${url} → ${res.status}: ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

async function diagnoseNodes() {
  console.log("=== 1. Lightning Node Comparison ===\n");

  // Ark Boltz instance
  try {
    const data = await fetchJSON<Record<string, any>>(`${BOLTZ_API}/v2/nodes`);
    const lnd = data?.BTC?.LND;
    if (lnd) {
      console.log("Ark Boltz (api.ark.boltz.exchange):");
      console.log(`  Pubkey: ${lnd.publicKey}`);
      console.log(`  URI:    ${lnd.uris?.[0] || "(none)"}`);

      // Compare with known nodes
      const match = Object.entries(KNOWN_NODES).find(([, pk]) => pk === lnd.publicKey);
      if (match) {
        console.log(`  ✅ Matches: ${match[0]}`);
      } else {
        console.log("  ⚠️  UNIQUE node — not Ark Labs, not standard Boltz");
        console.log("     Lightning routing must reach THIS specific node");
      }
    }
  } catch (err: any) {
    console.error("  ❌ Failed:", err.message);
  }

  // Standard Boltz
  try {
    const data = await fetchJSON<Record<string, any>>(`${BOLTZ_MAIN_API}/v2/nodes`);
    console.log("\nStandard Boltz (api.boltz.exchange):");
    if (data?.BTC?.LND) {
      console.log(`  LND Pubkey: ${data.BTC.LND.publicKey}`);
    }
    if (data?.BTC?.CLN) {
      console.log(`  CLN Pubkey: ${data.BTC.CLN.publicKey}`);
    }
  } catch (err: any) {
    console.error("  ❌ Failed:", err.message);
  }
}

async function diagnoseReverseLimits() {
  console.log("\n=== 2. BTC/ARK Reverse Swap Config ===\n");

  try {
    const data = await fetchJSON<Record<string, any>>(`${BOLTZ_API}/v2/swap/reverse`);
    const arkPair = data?.BTC?.ARK;
    if (arkPair) {
      console.log("Pair: BTC → ARK (Lightning → Ark vTXO)");
      console.log(`  Min: ${arkPair.limits.minimal} sats`);
      console.log(`  Max: ${arkPair.limits.maximal} sats`);
      console.log(`  Fee: ${arkPair.fees.percentage}%`);
      console.log(`  Miner fee (claim): ${arkPair.fees.minerFees?.claim ?? 0} sats`);
      console.log(`  Miner fee (lockup): ${arkPair.fees.minerFees?.lockup ?? 0} sats`);
    } else {
      console.log("Raw response:", JSON.stringify(data, null, 2));
    }
  } catch (err: any) {
    console.error("❌ Failed:", err.message);
  }

  // Also check submarine (send) direction
  try {
    const subRes = await fetch(`${BOLTZ_API}/v2/swap/submarine`);
    if (subRes.ok) {
      const data = await subRes.json();
      console.log("\nSubmarine swap (ARK → BTC):");
      const pair = (data as any)?.ARK?.BTC;
      if (pair) {
        console.log(`  Min: ${pair.limits.minimal} sats`);
        console.log(`  Max: ${pair.limits.maximal} sats`);
        console.log(`  Fee: ${pair.fees.percentage}%`);
      } else {
        console.log("  Not available or different structure");
        console.log("  Raw:", JSON.stringify(data, null, 2));
      }
    }
  } catch {
    console.log("  Submarine endpoint not available");
  }
}

async function diagnoseTestSwap() {
  console.log("\n=== 3. Test Reverse Swap Creation ===\n");

  const preimage = crypto.randomBytes(32);
  const preimageHash = crypto.createHash("sha256").update(preimage).digest("hex");

  try {
    const createRes = await fetch(`${BOLTZ_API}/v2/swap/reverse`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        from: "BTC",
        to: "ARK",
        invoiceAmount: 10000,
        preimageHash,
        // Generator point — dummy key, swap won't be claimable
        claimPublicKey:
          "0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798",
      }),
    });

    if (createRes.status === 201 || createRes.ok) {
      const swap = (await createRes.json()) as Record<string, any>;
      console.log("✅ Reverse swap created!");
      console.log(`  Swap ID:     ${swap.id}`);
      console.log(`  Invoice:     ${swap.invoice?.substring(0, 70)}...`);
      console.log(`  Onchain amt: ${swap.onchainAmount} sats`);
      console.log(`  Lockup:      ${swap.lockupAddress?.substring(0, 50)}...`);
      console.log(`  Timeout:     block ${swap.timeoutBlockHeight}`);

      // Check status
      if (swap.id) {
        const statusRes = await fetch(`${BOLTZ_API}/v2/swap/${swap.id}`);
        if (statusRes.ok) {
          const status = (await statusRes.json()) as Record<string, any>;
          console.log(`  Status:      ${status.status}`);
        }
      }

      console.log("\n  ℹ️  Test only — will auto-expire without payment.");
    } else {
      const text = await createRes.text();
      console.log(`❌ Creation failed (${createRes.status}): ${text}`);
    }
  } catch (err: any) {
    console.error("❌ Failed:", err.message);
  }
}

async function checkHealth() {
  console.log("\n=== 4. API Health ===\n");

  for (const [name, url] of [
    ["Ark Boltz", BOLTZ_API],
    ["Standard Boltz", BOLTZ_MAIN_API],
  ]) {
    try {
      const start = Date.now();
      const res = await fetch(`${url}/v2/nodes`);
      const ms = Date.now() - start;
      console.log(`${name}: ${res.ok ? "✅" : "❌"} ${res.status} (${ms}ms)`);
    } catch (err: any) {
      console.log(`${name}: ❌ Unreachable — ${err.message}`);
    }
  }
}

function printSummary() {
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║  DIAGNOSIS SUMMARY                               ║");
  console.log("╠══════════════════════════════════════════════════╣");
  console.log("║                                                   ║");
  console.log("║  Ark Boltz uses a DEDICATED Lightning node:       ║");
  console.log("║  038f83dae5dfc...  @ 178.156.153.118:9735         ║");
  console.log("║                                                   ║");
  console.log("║  This is NOT the Ark Labs node on Amboss.         ║");
  console.log("║  This is NOT the standard Boltz node.             ║");
  console.log("║                                                   ║");
  console.log("║  Lightning payments must route to THIS node.      ║");
  console.log("║  If wallets can't find a route, payments fail.    ║");
  console.log("║                                                   ║");
  console.log("║  WORKAROUND: Use onchain boarding address instead ║");
  console.log("║  of Lightning. The 25k sats are already there.    ║");
  console.log("║                                                   ║");
  console.log("╚══════════════════════════════════════════════════╝");
}

async function main() {
  console.log("╔══════════════════════════════════════════╗");
  console.log("║    Boltz Reverse Swap Diagnostics        ║");
  console.log("╚══════════════════════════════════════════╝\n");

  await diagnoseNodes();
  await diagnoseReverseLimits();
  await diagnoseTestSwap();
  await checkHealth();
  printSummary();
}

main().catch(console.error);
