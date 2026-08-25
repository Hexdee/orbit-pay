import "./style.css";
// The kit's v2 package exposes its default module set on a secondary export path.
import { defaultModules } from "@creit.tech/stellar-wallets-kit/modules/utils";
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
import { Account, BASE_FEE, Contract, Horizon, Networks, nativeToScVal, rpc, scValToNative, StrKey, TransactionBuilder } from "@stellar/stellar-sdk";
import { formatXlm, readableError, shortenAddress } from "./lib/format";

const RPC_URL = "https://soroban-testnet.stellar.org";
const HORIZON_URL = "https://horizon-testnet.stellar.org";
const NETWORK = Networks.TESTNET;
const TRACKER_ID = import.meta.env.VITE_PAYMENT_TRACKER_CONTRACT_ID || "CC3ZNNYZ5F74AVXQEHUI655TIM37AQE5Z3PBUHD3WPCSRHP4G2FYQ5BA";
const rpcServer = new rpc.Server(RPC_URL);
const horizon = new Horizon.Server(HORIZON_URL);
let walletAddress = "";
let balance = "0";
let syncTimer: number | undefined;

StellarWalletsKit.init({ modules: defaultModules() });
StellarWalletsKit.setNetwork(NETWORK);

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <div class="shell">
    <header class="topbar"><a class="brand" href="#top"><span class="brand-mark">◌</span> ORBIT <i>PAY</i></a><div class="network"><span></span> Stellar Testnet</div><button id="connect" class="button primary">Choose wallet</button></header>
    <main id="top">
      <section class="hero"><div class="eyebrow">YELLOW BELT · LIVE PAYMENT SIGNAL</div><h1>Every payment<br /><em>has a pulse.</em></h1><p>Connect any Stellar wallet, record a payment receipt on Soroban, and watch the activity feed update in real time.</p><div class="hero-points"><span>01 Any wallet</span><span>02 On-chain receipt</span><span>03 Live activity</span></div></section>
      <section class="dashboard">
        <article class="card wallet-card"><div class="card-label"><span>CONNECTED WALLET</span><span id="wallet-status-label" class="status-label">NOT CONNECTED</span></div><div class="wallet-value"><strong id="address">Choose a wallet</strong><small id="balance">Testnet balance unavailable</small></div><div class="wallet-actions"><button id="copy" class="icon-button" disabled>⧉ Copy address</button><button id="disconnect" class="text-button hidden">Disconnect</button></div><p id="status" class="status">The wallet picker supports Freighter, xBull, Lobstr, Albedo, Rabet, WalletConnect, and more.</p></article>
        <article class="card record-card"><div class="card-label"><span>RECORD PAYMENT</span><span>SOROBAN CONTRACT</span></div><form id="record-form"><label>Recipient address<input id="recipient" required placeholder="G…" autocomplete="off" /></label><label>Amount (XLM)<input id="amount" required type="number" min="0.0000001" step="0.0000001" placeholder="25.00" /></label><label>Payment note<input id="memo" required maxlength="48" placeholder="Design retainer" /></label><button id="record" class="button primary full" type="submit" disabled>Connect wallet to record <span>↗</span></button></form><div id="tx-result" class="tx-result hidden"></div></article>
      </section>
      <section class="activity"><div class="section-heading"><div><div class="eyebrow">REAL-TIME CONTRACT EVENTS</div><h2>Payment activity</h2></div><span id="sync" class="muted">Connect a wallet to sync</span></div><div id="events" class="event-list"><div class="empty">On-chain payment receipts will appear here.</div></div></section>
      <section class="how"><div><div class="eyebrow">THE YELLOW BELT FLOW</div><h2>One receipt.<br />Everyone sees the pulse.</h2></div><div class="steps"><div><b>01</b><h3>Choose</h3><p>Use the wallet your users already prefer through one wallet picker.</p></div><div><b>02</b><h3>Record</h3><p>Write a verified payment receipt to the Soroban tracker contract.</p></div><div><b>03</b><h3>Stream</h3><p>Poll contract events and synchronize the activity feed automatically.</p></div></div></section>
    </main><footer><span>ORBIT PAY · YELLOW BELT</span><span>Built on Stellar Soroban</span></footer>
  </div>`;

const $ = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;
const connectButton = $("#connect") as HTMLButtonElement;
const disconnectButton = $("#disconnect") as HTMLButtonElement;
const copyButton = $("#copy") as HTMLButtonElement;
const recordButton = $("#record") as HTMLButtonElement;
const statusEl = $("#status");
const txResult = $("#tx-result");

function setStatus(message: string, kind = "") { statusEl.textContent = message; statusEl.className = `status ${kind}`; }
function configured() { return TRACKER_ID.length > 50; }
function activeWallet() { if (!walletAddress) throw new Error("Choose a wallet before continuing."); return walletAddress; }
function argsFor(args: unknown[], types: string[]) { return args.map((arg, index) => nativeToScVal(arg, { type: types[index] })); }
function walletError(error: unknown) { const message = readableError(error); if (/reject|cancel|denied|declin/i.test(message)) return "Wallet request rejected. Try again when you are ready."; if (/not found|install|unavailable|unsupported/i.test(message)) return "That wallet is unavailable. Choose another wallet from the picker."; return message; }

async function loadAccount() {
  try { return await horizon.loadAccount(activeWallet()); }
  catch (error) { if (/not found|404/i.test(readableError(error))) throw new Error("This wallet is not funded on Testnet. Fund it with Friendbot, then reconnect."); throw error; }
}

async function refreshWallet() {
  const account = await loadAccount();
  const native = account.balances.find((item) => item.asset_type === "native");
  if (!native || native.asset_type !== "native") throw new Error("No XLM balance found for this Testnet wallet.");
  balance = native.balance;
  $("#address").textContent = shortenAddress(walletAddress, 8);
  $("#address").setAttribute("title", walletAddress);
  $("#balance").textContent = `${formatXlm(balance)} XLM · Testnet`;
  $("#wallet-status-label").textContent = "CONNECTED";
  $("#wallet-status-label").className = "status-label connected";
  connectButton.textContent = "Switch wallet";
  connectButton.className = "button secondary";
  disconnectButton.classList.remove("hidden"); copyButton.disabled = false; recordButton.disabled = false;
}

async function buildContractTransaction(method: string, args: unknown[], types: string[]) {
  const source = await loadAccount();
  return new TransactionBuilder(new Account(source.accountId(), source.sequence), { fee: BASE_FEE, networkPassphrase: NETWORK }).addOperation(new Contract(TRACKER_ID).call(method, ...argsFor(args, types))).setTimeout(180).build();
}

async function write(method: string, args: unknown[], types: string[]) {
  const tx = await buildContractTransaction(method, args, types);
  const simulated = await rpcServer.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(simulated)) throw new Error(simulated.error);
  const prepared = rpc.assembleTransaction(tx, simulated).build();
  const signed = await StellarWalletsKit.signTransaction(prepared.toXDR(), { networkPassphrase: NETWORK, address: activeWallet() });
  const sent = await rpcServer.sendTransaction(TransactionBuilder.fromXDR(signed.signedTxXdr, NETWORK));
  if (sent.status === "ERROR") throw new Error("The network rejected the transaction.");
  return sent.hash;
}

function renderEvents(events: any[]) {
  const rows = events.map((event) => {
    const topic = event.topic.map((value: any) => scValToNative(value));
    const data = scValToNative(event.value);
    const amount = Array.isArray(data) ? BigInt(data[1]) : BigInt(data ?? 0);
    return `<div class="event-row"><div class="event-icon">✦</div><div class="event-copy"><strong>Payment #${String(topic[2])} recorded</strong><span>${formatXlm(Number(amount) / 10_000_000)} XLM · ${shortenAddress(String(topic[1]), 6)} · ledger ${event.ledger}</span></div><a href="https://stellar.expert/explorer/testnet/tx/${event.txHash}" target="_blank" rel="noreferrer">View tx ↗</a></div>`;
  }).join("");
  $("#events").innerHTML = rows || `<div class="empty">No payment receipts yet. Record the first one.</div>`;
}

async function refreshEvents() {
  const latest = await rpcServer.getLatestLedger();
  const result = await rpcServer.getEvents({ startLedger: Math.max(1, latest.sequence - 500), filters: [{ type: "contract", contractIds: [TRACKER_ID] }], limit: 30 });
  const paymentEvents = result.events.filter((event) => String(scValToNative(event.topic[0])) === "payment").reverse();
  renderEvents(paymentEvents);
  $("#sync").textContent = `Live · ledger ${latest.sequence}`;
}

async function connect() {
  if (!configured()) throw new Error("The Yellow Belt contract is not configured yet.");
  setStatus("Opening the multi-wallet picker…");
  const access = await StellarWalletsKit.authModal();
  walletAddress = access.address;
  await refreshWallet();
  setStatus("Wallet connected · balance synced from Stellar Testnet", "success");
  await refreshEvents();
  if (syncTimer === undefined) syncTimer = window.setInterval(() => { void Promise.all([refreshWallet(), refreshEvents()]).catch((error) => setStatus(walletError(error), "error")); }, 8_000);
}

function disconnect() { walletAddress = ""; balance = "0"; $("#address").textContent = "Choose a wallet"; $("#balance").textContent = "Testnet balance unavailable"; $("#wallet-status-label").textContent = "NOT CONNECTED"; $("#wallet-status-label").className = "status-label"; connectButton.textContent = "Choose wallet"; connectButton.className = "button primary"; disconnectButton.classList.add("hidden"); copyButton.disabled = true; recordButton.disabled = true; setStatus("Wallet disconnected. Connect again to continue."); }

connectButton.addEventListener("click", async () => { try { await connect(); } catch (error) { setStatus(walletError(error), "error"); } });
disconnectButton.addEventListener("click", disconnect);
copyButton.addEventListener("click", async () => { await navigator.clipboard.writeText(walletAddress); setStatus("Wallet address copied.", "success"); });

$("#record-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const recipient = ($("#recipient") as HTMLInputElement).value.trim();
  const amount = Number(document.querySelector<HTMLInputElement>("#amount")!.value);
  const memo = ($("#memo") as HTMLInputElement).value.trim();
  if (!StrKey.isValidEd25519PublicKey(recipient)) { setStatus("Enter a valid Stellar recipient address.", "error"); return; }
  if (!Number.isFinite(amount) || amount <= 0) { setStatus("Enter an amount greater than 0 XLM.", "error"); return; }
  recordButton.disabled = true; txResult.className = "tx-result hidden";
  try {
    setStatus("Simulating contract call…");
    const hash = await write("record_payment", [activeWallet(), recipient, Math.round(amount * 10_000_000), memo], ["address", "address", "i128", "string"]);
    txResult.innerHTML = `<strong>Contract call submitted</strong><a href="https://stellar.expert/explorer/testnet/tx/${hash}" target="_blank" rel="noreferrer">View transaction · ${shortenAddress(hash, 7)} ↗</a>`;
    txResult.className = "tx-result success-box"; setStatus("Success · payment receipt confirmed on Soroban", "success");
    await refreshEvents(); ($("#record-form") as HTMLFormElement).reset();
  } catch (error) { txResult.textContent = walletError(error); txResult.className = "tx-result error-box"; setStatus(walletError(error), "error"); }
  finally { recordButton.disabled = !walletAddress; }
});
