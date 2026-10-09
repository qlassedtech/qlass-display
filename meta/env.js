// Loads ../.env for CLI use (the server gets env from docker compose / the shell).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const envFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env");
if (fs.existsSync(envFile)) {
  try { process.loadEnvFile(envFile); } catch { /* already loaded or unsupported */ }
}
