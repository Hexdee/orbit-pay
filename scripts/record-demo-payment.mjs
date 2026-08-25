import { Account, Address, BASE_FEE, Contract, Keypair, Networks, TransactionBuilder, nativeToScVal, rpc } from "@stellar/stellar-sdk";

const secret = process.env.STELLAR_SECRET;
const contractId = process.env.PAYMENT_TRACKER_CONTRACT_ID;
if (!secret || !contractId) throw new Error("STELLAR_SECRET and PAYMENT_TRACKER_CONTRACT_ID are required");

const keypair = Keypair.fromSecret(secret.trim());
const networkPassphrase = Networks.TESTNET;
const server = new rpc.Server("https://soroban-testnet.stellar.org");
const account = await server.getAccount(keypair.publicKey());
const recipient = Address.fromString(keypair.publicKey());
const operation = new Contract(contractId).call(
  "record_payment",
  Address.fromString(keypair.publicKey()).toScVal(),
  recipient.toScVal(),
  nativeToScVal(1_000_000, { type: "i128" }),
  nativeToScVal("Orbit Pay Yellow Belt demo", { type: "string" }),
);
const transaction = new TransactionBuilder(new Account(account.accountId(), String(account.sequence)), { fee: BASE_FEE, networkPassphrase }).addOperation(operation).setTimeout(300).build();
const simulation = await server.simulateTransaction(transaction);
if (rpc.Api.isSimulationError(simulation)) throw new Error(simulation.error);
const prepared = rpc.assembleTransaction(transaction, simulation).build();
prepared.sign(keypair);
const sent = await server.sendTransaction(prepared);
if (sent.status === "ERROR") throw new Error(JSON.stringify(sent));
for (let attempt = 0; attempt < 30; attempt += 1) {
  const result = await server.getTransaction(sent.hash);
  if (result.status === rpc.Api.GetTransactionStatus.SUCCESS) {
    console.log(JSON.stringify({ contractId, payer: keypair.publicKey(), hash: sent.hash }, null, 2));
    process.exit(0);
  }
  if (result.status === rpc.Api.GetTransactionStatus.FAILED) throw new Error(JSON.stringify(result));
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
throw new Error(`Timed out waiting for ${sent.hash}`);
