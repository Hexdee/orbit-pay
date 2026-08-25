import { cp, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";

const command = process.platform === "win32" ? "cargo.exe" : "cargo";
const build = spawn(command, ["build", "--manifest-path", "contracts/payment-tracker/Cargo.toml", "--target", "wasm32v1-none", "--release"], { stdio: "inherit" });
build.on("error", (error) => { throw error; });
build.on("exit", async (code) => {
  if (code !== 0) process.exit(code ?? 1);
  await mkdir("artifacts", { recursive: true });
  await cp("target/wasm32v1-none/release/payment_tracker.wasm", "artifacts/payment_tracker.wasm");
});
