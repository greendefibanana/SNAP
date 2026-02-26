import fs from "node:fs";
import path from "node:path";
import { PublicKey } from "@solana/web3.js";

const rootDir = process.cwd();
const multiplayerArg = readArg("--multiplayer");
const vrfArg = readArg("--vrf");
const provenanceArg = readArg("--provenance");

const multiplayerProgramId =
  multiplayerArg ?? process.env.SNAP_MULTIPLAYER_AUTHORITY_PROGRAM_ID;
const vrfProgramId = vrfArg ?? process.env.SNAP_VRF_ENGINE_PROGRAM_ID;
const provenanceProgramId =
  provenanceArg ?? process.env.SNAP_PROVENANCE_REGISTRY_PROGRAM_ID;

if (!multiplayerProgramId || !vrfProgramId || !provenanceProgramId) {
  fail(
    "Missing program IDs. Pass --multiplayer, --vrf, --provenance or set SNAP_MULTIPLAYER_AUTHORITY_PROGRAM_ID, SNAP_VRF_ENGINE_PROGRAM_ID, SNAP_PROVENANCE_REGISTRY_PROGRAM_ID."
  );
}

assertPubkey("SNAP_MULTIPLAYER_AUTHORITY_PROGRAM_ID", multiplayerProgramId);
assertPubkey("SNAP_VRF_ENGINE_PROGRAM_ID", vrfProgramId);
assertPubkey("SNAP_PROVENANCE_REGISTRY_PROGRAM_ID", provenanceProgramId);

const multiplayerLibPath = path.join(
  rootDir,
  "programs",
  "snap-multiplayer-authority",
  "src",
  "lib.rs"
);
const vrfLibPath = path.join(
  rootDir,
  "programs",
  "snap-vrf-engine",
  "src",
  "lib.rs"
);
const provenanceLibPath = path.join(
  rootDir,
  "programs",
  "snap-provenance-registry",
  "src",
  "lib.rs"
);
const anchorTomlPath = path.join(rootDir, "Anchor.toml");

replaceDeclareId(multiplayerLibPath, multiplayerProgramId);
replaceDeclareId(vrfLibPath, vrfProgramId);
replaceDeclareId(provenanceLibPath, provenanceProgramId);
replaceAnchorProgramId(
  anchorTomlPath,
  "snap_multiplayer_authority",
  multiplayerProgramId
);
replaceAnchorProgramId(anchorTomlPath, "snap_vrf_engine", vrfProgramId);
replaceAnchorProgramId(
  anchorTomlPath,
  "snap_provenance_registry",
  provenanceProgramId
);

console.log("Updated program IDs:");
console.log(`- snap_multiplayer_authority: ${multiplayerProgramId}`);
console.log(`- snap_vrf_engine: ${vrfProgramId}`);
console.log(`- snap_provenance_registry: ${provenanceProgramId}`);

function readArg(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function assertPubkey(label, value) {
  try {
    const key = new PublicKey(value);
    if (key.toBase58() !== value) {
      fail(`${label} must be a base58 Solana public key.`);
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : "invalid key";
    fail(`${label} is invalid: ${reason}`);
  }
}

function replaceDeclareId(filePath, programId) {
  const content = fs.readFileSync(filePath, "utf8");
  const next = content.replace(
    /declare_id!\("([1-9A-HJ-NP-Za-km-z]{32,44})"\);/,
    `declare_id!("${programId}");`
  );
  if (next === content) {
    fail(`Could not update declare_id! in ${filePath}`);
  }
  fs.writeFileSync(filePath, next, "utf8");
}

function replaceAnchorProgramId(filePath, programName, programId) {
  const content = fs.readFileSync(filePath, "utf8");
  const pattern = new RegExp(
    `(${escapeRegExp(programName)}\\s*=\\s*")([1-9A-HJ-NP-Za-km-z]{32,44})(")`,
    "m"
  );
  const next = content.replace(pattern, `$1${programId}$3`);
  if (next === content) {
    fail(`Could not update ${programName} in ${filePath}`);
  }
  fs.writeFileSync(filePath, next, "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
