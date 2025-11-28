// Environment configurations for different Solana networks
export interface EnvironmentConfig {
  rpcUrl: string;
  wsUrl: string;
  name: string;
  description: string;
}

const DEFAULT_REMOTE_HOST = "localhost";
const DEFAULT_RPC_PORT = "8899";
const DEFAULT_WS_PORT = "8900";

const getBrowserHostname = (): string | undefined => {
  if (typeof window === "undefined" || !window.location.hostname) {
    return undefined;
  }
  return window.location.hostname;
};

const getBrowserProtocol = (): string | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }
  return window.location.protocol.replace(":", "");
};

const remoteHost =
  getBrowserHostname() ||
  import.meta.env.VITE_REMOTE_RPC_HOST ||
  DEFAULT_REMOTE_HOST;
const remoteRpcProtocol =
  import.meta.env.VITE_REMOTE_RPC_PROTOCOL || getBrowserProtocol() || "http";
const remoteWsProtocol =
  import.meta.env.VITE_REMOTE_WS_PROTOCOL ||
  (remoteRpcProtocol === "https" ? "wss" : "ws");
const remoteRpcPort =
  import.meta.env.VITE_REMOTE_RPC_PORT || DEFAULT_RPC_PORT;
const remoteWsPort =
  import.meta.env.VITE_REMOTE_WS_PORT || DEFAULT_WS_PORT;

const buildUrl = (protocol: string, host: string, port?: string) => {
  const suffix = port ? `:${port}` : "";
  return `${protocol}://${host}${suffix}`;
};

export const environments: Record<string, EnvironmentConfig> = {
  local: {
    rpcUrl: "http://127.0.0.1:8899",
    wsUrl: "ws://127.0.0.1:8900",
    name: "Local",
    description: "Local development validator",
  },
  remote: {
    rpcUrl: buildUrl(remoteRpcProtocol, remoteHost, remoteRpcPort),
    wsUrl: buildUrl(remoteWsProtocol, remoteHost, remoteWsPort),
    name: "Remote",
    description: `Remote development server (${remoteHost})`,
  },
  devnet: {
    rpcUrl: "https://api.devnet.solana.com",
    wsUrl: "wss://api.devnet.solana.com",
    name: "Devnet",
    description: "Solana Devnet",
  },
  mainnet: {
    rpcUrl: "https://api.mainnet-beta.solana.com",
    wsUrl: "wss://api.mainnet-beta.solana.com",
    name: "Mainnet",
    description: "Solana Mainnet",
  },
};

// Get current environment from localStorage or default to local
export const getCurrentEnvironment = (): string => {
  return localStorage.getItem("solana-environment") || "local";
};

// Set current environment
export const setCurrentEnvironment = (env: string): void => {
  localStorage.setItem("solana-environment", env);
};

// Get current environment config
export const getCurrentEnvironmentConfig = (): EnvironmentConfig => {
  const currentEnv = getCurrentEnvironment();
  return environments[currentEnv] || environments.local;
};
