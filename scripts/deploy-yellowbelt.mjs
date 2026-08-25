import crypto from "node:crypto";
import fs from "node:fs";
import { Account, Address, BASE_FEE, Contract, Keypair, Networks, Operation, TransactionBuilder, rpc, scValToNative } from "@stellar/stellar-sdk";

const secret = process.env.STELLAR_SECRET;
if (!secret) throw new Error("STELLAR_SECRET is required");
const keypair = Keypair.fromSecret(secret.trim());
const networkPassphrase = Networks.TESTNET;
const server = new rpc.Server("https://soroban-testnet.stellar.org");
const deployment = { network: "testnet", admin: keypair.publicKey() };

async function submit(operation) {
  const source = await server.getAccount(keypair.publicKey());
  const raw = new TransactionBuilder(new Account(source.accountId(), String(source.sequence)), { fee: BASE_FEE, networkPassphrase }).addOperation(operation).setTimeout(300).build();
  const simulation = await server.simulateTransaction(raw);
  if (rpc.Api.isSimulationError(simulation)) throw new Error(simulation.error);
  const prepared = rpc.assembleTransaction(raw, simulation).build();
  prepared.sign(keypair);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") throw new Error(JSON.stringify(sent));
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await server.getTransaction(sent.hash);
    if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) return { hash: sent.hash, result };
    if (result.status === rpc.Api.GetTransactionStatus.FAILED) throw new Error(JSON.stringify(result));
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`Timed out waiting for ${sent.hash}`);
}

const wasm = fs.readFileSync(new URL("../artifacts/payment_tracker.wasm", import.meta.url));
const wasmHash = crypto.createHash("sha256").update(wasm).digest();
try { await server.getContractWasmByHash(wasmHash); } catch { await submit(Operation.uploadContractWasm({ wasm })); }
const deploymentTx = await submit(Operation.createCustomContract({ address: Address.fromString(keypair.publicKey()), wasmHash, salt: Buffer.alloc(32, 31) }));
const contractId = String(scValToNative(deploymentTx.result.returnValue));
const initializeTx = await submit(new Contract(contractId).call("initialize"));
deployment.contract = { contractId, deployTxHash: deploymentTx.hash, wasmHash: wasmHash.toString("hex"), initializeTxHash: initializeTx.hash };
fs.writeFileSync(new URL("../deployments.testnet.json", import.meta.url), `${JSON.stringify(deployment, null, 2)}\n`);
console.log(JSON.stringify(deployment, null, 2));
