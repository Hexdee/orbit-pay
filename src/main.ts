import "./style.css";
import { getNetworkDetails, isConnected, requestAccess, signTransaction } from "@stellar/freighter-api";
import { Account, Asset, BASE_FEE, Horizon, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { formatXlm, readableError, shortenAddress } from "./lib/format";

const HORIZON_URL = "https://horizon-testnet.stellar.org";
const NETWORK = Networks.TESTNET;
const horizon = new Horizon.Server(HORIZON_URL);
let walletAddress = "";
let balance = "0";

const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <a class="brand" href="#top"><span class="brand-mark">◌</span> ORBIT <i>PAY</i></a>
      <div class="network"><span></span> Stellar Testnet</div>
      <button id="connect" class="button primary">Connect Freighter</button>
    </header>
    <main id="top">
      <section class="hero">
        <div class="eyebrow">WHITE BELT · PAYMENT BASICS</div>
        <h1>Move money<br /><em>simply.</em></h1>
        <p>A focused XLM payment experience for Stellar Testnet. Connect your wallet, check your balance, and send a real transaction in seconds.</p>
        <div class="hero-points"><span>01 Wallet</span><span>02 Balance</span><span>03 Transfer</span></div>
      </section>
      <section class="dashboard">
        <article class="card balance-card">
          <div class="card-label"><span>YOUR TESTNET BALANCE</span><span class="live-dot">● LIVE</span></div>
          <div class="balance-value"><strong id="balance">—</strong><small>XLM</small></div>
          <div class="account-row"><span id="address">Connect a wallet to begin</span><button id="copy" class="icon-button" disabled title="Copy wallet address">⧉</button></div>
          <p id="wallet-state" class="status">Freighter connection required.</p>
        </article>
        <article class="card send-card">
          <div class="card-label"><span>SEND XLM</span><span>TESTNET ONLY</span></div>
          <form id="send-form">
            <label>Recipient Stellar address<input id="recipient" required placeholder="G…" autocomplete="off" /></label>
            <label>Amount<input id="amount" required type="number" min="0.0000001" step="0.0000001" placeholder="0.00" /></label>
            <button id="send" class="button primary full" type="submit" disabled>Connect wallet to send <span>↗</span></button>
          </form>
          <div id="tx-result" class="tx-result hidden"></div>
        </article>
      </section>
      <section class="how">
        <div><div class="eyebrow">HOW IT WORKS</div><h2>One clear flow.<br />One confirmed payment.</h2></div>
        <div class="steps"><div><b>01</b><h3>Connect</h3><p>Freighter signs locally. Orbit Pay never sees your secret key.</p></div><div><b>02</b><h3>Prepare</h3><p>Enter a recipient and amount. The transaction is built for Testnet.</p></div><div><b>03</b><h3>Confirm</h3><p>Sign in Freighter and receive a link to the confirmed transaction.</p></div></div>
      </section>
    </main>
    <footer><span>ORBIT PAY · STELLAR WHITE BELT</span><span>Built for Stellar Testnet</span></footer>
  </div>`;

const $ = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;
const connectButton = $("#connect") as HTMLButtonElement;
const balanceEl = $("#balance");
const addressEl = $("#address");
const stateEl = $("#wallet-state");
const sendButton = $("#send") as HTMLButtonElement;
const copyButton = $("#copy") as HTMLButtonElement;
const txResult = $("#tx-result");

function setState(message: string, kind = "") {
  stateEl.textContent = message;
  stateEl.className = `status ${kind}`;
}

function setConnected(address: string, value: string) {
  walletAddress = address;
  balance = value;
  addressEl.textContent = shortenAddress(address, 8);
  addressEl.setAttribute("title", address);
  balanceEl.textContent = formatXlm(value);
  connectButton.textContent = "Disconnect";
  connectButton.className = "button secondary";
  sendButton.disabled = false;
  sendButton.textContent = "Send XLM ↗";
  copyButton.disabled = false;
}

function disconnect() {
  walletAddress = "";
  balance = "0";
  addressEl.textContent = "Connect a wallet to begin";
  addressEl.removeAttribute("title");
  balanceEl.textContent = "—";
  connectButton.textContent = "Connect Freighter";
  connectButton.className = "button primary";
  sendButton.disabled = true;
  sendButton.textContent = "Connect wallet to send";
  copyButton.disabled = true;
  setState("Wallet disconnected. Your Freighter permissions remain unchanged.");
}

async function loadBalance(address: string) {
  try {
    const account = await horizon.loadAccount(address);
    const native = account.balances.find((item) => item.asset_type === "native");
    if (!native || native.asset_type !== "native") throw new Error("No XLM balance was found for this account.");
    setConnected(address, native.balance);
    setState("Wallet connected · balance synced from Stellar Testnet", "success");
  } catch (error) {
    if (/not found|404/i.test(readableError(error))) throw new Error("This wallet is not funded on Testnet. Use Friendbot, then connect again.");
    throw error;
  }
}

async function connect() {
  const connection = await isConnected();
  if (!connection.isConnected) throw new Error("Freighter was not detected. Install or enable the extension, then reload.");
  const network = await getNetworkDetails();
  if (network.error) throw new Error(typeof network.error === "string" ? network.error : network.error.message);
  if (network.network !== "TESTNET") throw new Error("Switch Freighter to Stellar Testnet, then connect again.");
  const access = await requestAccess();
  if (access.error) throw new Error(typeof access.error === "string" ? access.error : access.error.message);
  await loadBalance(access.address);
}

async function sendPayment(recipient: string, amount: string) {
  if (!walletAddress) throw new Error("Connect Freighter before sending XLM.");
  if (recipient === walletAddress) throw new Error("Choose a recipient different from your connected wallet.");
  const source = await horizon.loadAccount(walletAddress);
  const transaction = new TransactionBuilder(new Account(source.accountId(), source.sequence), { fee: BASE_FEE, networkPassphrase: NETWORK })
    .addOperation(Operation.payment({ destination: recipient, asset: Asset.native(), amount }))
    .setTimeout(180)
    .build();
  const signed = await signTransaction(transaction.toXDR(), { networkPassphrase: NETWORK, address: walletAddress });
  if (signed.error) throw new Error(typeof signed.error === "string" ? signed.error : signed.error.message);
  const submitted = await horizon.submitTransaction(TransactionBuilder.fromXDR(signed.signedTxXdr, NETWORK));
  return submitted.hash;
}

connectButton.addEventListener("click", async () => {
  if (walletAddress) { disconnect(); return; }
  try { setState("Opening Freighter…"); await connect(); }
  catch (error) { setState(readableError(error), "error"); }
});

copyButton.addEventListener("click", async () => {
  if (!walletAddress) return;
  await navigator.clipboard.writeText(walletAddress);
  setState("Wallet address copied to clipboard.", "success");
});

$("#send-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const recipient = ($("#recipient") as HTMLInputElement).value.trim();
  const amount = ($("#amount") as HTMLInputElement).value;
  sendButton.disabled = true;
  txResult.className = "tx-result hidden";
  try {
    setState("Waiting for Freighter signature…");
    const hash = await sendPayment(recipient, amount);
    txResult.innerHTML = `<strong>Payment confirmed</strong><a href="https://stellar.expert/explorer/testnet/tx/${hash}" target="_blank" rel="noreferrer">View transaction · ${shortenAddress(hash, 7)} ↗</a>`;
    txResult.className = "tx-result success-box";
    setState("Success · your XLM payment is confirmed on Testnet", "success");
    await loadBalance(walletAddress);
    ($("#send-form") as HTMLFormElement).reset();
  } catch (error) {
    txResult.textContent = readableError(error);
    txResult.className = "tx-result error-box";
    setState(readableError(error), "error");
  } finally { sendButton.disabled = !walletAddress; }
});
