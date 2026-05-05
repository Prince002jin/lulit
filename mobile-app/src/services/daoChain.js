import Constants from "expo-constants";
import { Wallet, hexlify, toUtf8Bytes } from "ethers";
import { Linking } from "react-native";
import UniversalProvider from "@walletconnect/universal-provider";
import api from "./api";

const WALLETCONNECT_PROJECT_ID = process.env.EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID || "";
const ENABLE_DEV_WALLET = process.env.EXPO_PUBLIC_ENABLE_DEV_WALLET === "true";
const DEV_WALLET_PRIVATE_KEY = process.env.EXPO_PUBLIC_DEV_WALLET_PRIVATE_KEY || "";
const APP_SCHEME = "lulit://";
const META_MASK_WALLET_URI = "metamask://";
const META_MASK_WC_URL = "https://metamask.app.link/wc?uri=";

let wcProvider = null;
let activeAddress = "";
let activeChainId = "eip155:1";
let walletMode = "walletconnect";

function detectExpoHost() {
  const candidates = [
    Constants.expoConfig?.hostUri,
    Constants.manifest2?.extra?.expoClient?.hostUri,
    Constants.linkingUri
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const normalized = candidate
      .replace(/^[a-z]+:\/\//i, "")
      .split("/")[0]
      .split(":")[0];

    if (normalized) {
      return normalized;
    }
  }

  return "";
}

function getWebDaoFallbackUrl() {
  if (process.env.EXPO_PUBLIC_WEB_DAO_FALLBACK_URL) {
    return process.env.EXPO_PUBLIC_WEB_DAO_FALLBACK_URL;
  }

  if (typeof window !== "undefined" && window.location?.hostname) {
    return `http://${window.location.hostname}:5173/dao`;
  }

  const expoHost = detectExpoHost();
  if (expoHost) {
    return `http://${expoHost}:5173/dao`;
  }

  return "http://localhost:5173/dao";
}

function getRedirectUri() {
  if (Constants.linkingUri) {
    return Constants.linkingUri;
  }

  const configuredScheme = Constants.expoConfig?.scheme;
  if (configuredScheme) {
    return `${configuredScheme}://`;
  }

  return APP_SCHEME;
}

const WEB_DAO_FALLBACK_URL = getWebDaoFallbackUrl();
const APP_REDIRECT_URI = getRedirectUri();

function getDevWallet() {
  if (!ENABLE_DEV_WALLET || !DEV_WALLET_PRIVATE_KEY) {
    return null;
  }
  try {
    return new Wallet(DEV_WALLET_PRIVATE_KEY.trim());
  } catch {
    throw new Error("Invalid EXPO_PUBLIC_DEV_WALLET_PRIVATE_KEY in mobile-app/.env");
  }
}

async function openWebDaoFallback() {
  await Linking.openURL(WEB_DAO_FALLBACK_URL);
}

async function tryOpenUrl(url) {
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

async function handleMissingMetaMask() {
  try {
    await openWebDaoFallback();
    const error = new Error("MetaMask Mobile is not installed. Opened the web DAO flow instead.");
    error.code = "WEB_DAO_FALLBACK";
    throw error;
  } catch (fallbackError) {
    if (fallbackError?.code === "WEB_DAO_FALLBACK") {
      throw fallbackError;
    }
    throw new Error("MetaMask Mobile is not installed on this device");
  }
}

async function openMetaMask(uri) {
  if (uri) {
    const encoded = encodeURIComponent(uri);
    if (await tryOpenUrl(`${META_MASK_WC_URL}${encoded}`)) {
      return;
    }

    if (await tryOpenUrl(`metamask://wc?uri=${encoded}`)) {
      return;
    }

    if (await tryOpenUrl(META_MASK_WALLET_URI)) {
      return;
    }

    await handleMissingMetaMask();
    return;
  }

  if (await tryOpenUrl(META_MASK_WALLET_URI)) {
    return;
  }

  if (await tryOpenUrl("https://metamask.app.link/")) {
    return;
  }

  await handleMissingMetaMask();
}

function firstSessionAccount(session) {
  const namespaces = session?.namespaces || {};
  const allAccounts = Object.values(namespaces).flatMap((ns) => ns?.accounts || []);
  return allAccounts[0] || "";
}

function parseAccount(account) {
  const parts = String(account || "").split(":");
  if (parts.length !== 3) {
    return { chainId: "eip155:1", address: "" };
  }
  return { chainId: `${parts[0]}:${parts[1]}`, address: parts[2] };
}

async function initProvider() {
  if (!WALLETCONNECT_PROJECT_ID) {
    throw new Error("Missing EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID in mobile-app/.env");
  }
  if (!wcProvider) {
    wcProvider = await UniversalProvider.init({
      projectId: WALLETCONNECT_PROJECT_ID,
      metadata: {
        name: "Lulit Mobile",
        description: "Lulit DAO mobile governance",
        url: "https://lulit.local",
        icons: ["https://walletconnect.com/walletconnect-logo.png"],
        redirect: {
          native: APP_REDIRECT_URI,
          universal: "https://lulit.local"
        }
      }
    });

    wcProvider.on("display_uri", (uri) => {
      openMetaMask(uri).catch(() => {});
    });

    wcProvider.on("disconnect", () => {
      activeAddress = "";
      activeChainId = "eip155:1";
    });

    wcProvider.on("accountsChanged", (accounts) => {
      const parsed = parseAccount(accounts?.[0]);
      activeAddress = parsed.address || "";
      activeChainId = parsed.chainId || "eip155:1";
    });

    wcProvider.on("chainChanged", (chainId) => {
      if (chainId) {
        activeChainId = String(chainId).startsWith("eip155:")
          ? String(chainId)
          : `eip155:${String(chainId).replace("0x", "")}`;
      }
    });
  }
  return wcProvider;
}

export async function connectWallet() {
  const devWallet = getDevWallet();
  const provider = await initProvider();
  await openMetaMask();
  if (!provider.session) {
    try {
      await provider.connect({
        namespaces: {
          eip155: {
            methods: ["eth_sendTransaction", "personal_sign", "eth_signTypedData", "eth_signTypedData_v4", "eth_sign"],
            chains: ["eip155:1", "eip155:11155111"],
            events: ["chainChanged", "accountsChanged", "disconnect"]
          }
        }
      });
      walletMode = "walletconnect";
    } catch (error) {
      if (!devWallet) {
        throw error;
      }
      activeAddress = devWallet.address;
      activeChainId = "eip155:31337";
      walletMode = "dev";
      return activeAddress;
    }
  }

  if (provider.session) {
    const account = firstSessionAccount(provider.session);
    const parsed = parseAccount(account);
    activeAddress = parsed.address || "";
    activeChainId = parsed.chainId || "eip155:1";
    walletMode = "walletconnect";
  }

  if (!activeAddress) {
    throw new Error("No wallet account returned");
  }
  return activeAddress;
}

async function signDaoMessage(message) {
  const address = await connectWallet();
  if (walletMode === "dev") {
    const devWallet = getDevWallet();
    if (!devWallet) {
      throw new Error("Dev wallet is not configured");
    }
    return devWallet.signMessage(message);
  }
  const provider = await initProvider();
  if (!provider.session?.topic) {
    throw new Error("Wallet session not initialized");
  }
  const requestPromise = provider.request({
    topic: provider.session.topic,
    chainId: activeChainId,
    request: {
      method: "personal_sign",
      params: [hexlify(toUtf8Bytes(message)), address]
    }
  });
  await openMetaMask();
  const signature = await requestPromise;
  return String(signature || "");
}

export async function signWalletMessage(message) {
  return signDaoMessage(message);
}

export async function disconnectWallet() {
  if (wcProvider?.disconnect) {
    await wcProvider.disconnect();
  }
  activeAddress = "";
  activeChainId = "eip155:1";
  walletMode = "walletconnect";
}

export function currentWalletAddress() {
  return activeAddress;
}

export function currentWalletMode() {
  return walletMode;
}

export async function verifyWalletSession(wallet) {
  const challenge = await api.post("/dao/signature/challenge", {
    wallet,
    purpose: "AUTH"
  });
  const signature = await signDaoMessage(challenge.data.message);
  const { data } = await api.post("/dao/auth/verify", {
    wallet,
    nonce: challenge.data.nonce,
    signature
  });
  return data;
}

export async function fetchWalletGovernanceStats(wallet) {
  const { data } = await api.get(`/dao/eligibility/${wallet}`);
  return data;
}

export async function createProposalSigned(payload) {
  const challenge = await api.post("/dao/signature/challenge", {
    wallet: payload.wallet,
    purpose: "CREATE_PROPOSAL"
  });
  const signature = await signDaoMessage(challenge.data.message);
  const { data } = await api.post("/dao/proposals", {
    ...payload,
    nonce: challenge.data.nonce,
    signature
  });
  return data;
}

export async function castVoteSigned(proposalId, wallet, choice) {
  const challenge = await api.post("/dao/signature/challenge", {
    wallet,
    purpose: "CAST_VOTE",
    proposalId,
    choice
  });
  const signature = await signDaoMessage(challenge.data.message);
  const { data } = await api.post(`/dao/proposals/${proposalId}/vote`, {
    wallet,
    choice,
    nonce: challenge.data.nonce,
    signature
  });
  return data;
}
