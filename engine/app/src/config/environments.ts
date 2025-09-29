// Environment configurations for different Solana networks
export interface EnvironmentConfig {
  rpcUrl: string;
  wsUrl: string;
  name: string;
  description: string;
}

export const environments: Record<string, EnvironmentConfig> = {
  local: {
    rpcUrl: 'http://127.0.0.1:8899',
    wsUrl: 'ws://127.0.0.1:8900',
    name: 'Local',
    description: 'Local development validator'
  },
  remote: {
    rpcUrl: 'http://10.186.0.84:8899',
    wsUrl: 'ws://10.186.0.84:8900',
    name: 'Remote',
    description: 'Remote development server (10.186.0.84)'
  },
  devnet: {
    rpcUrl: 'https://api.devnet.solana.com',
    wsUrl: 'wss://api.devnet.solana.com',
    name: 'Devnet',
    description: 'Solana Devnet'
  },
  mainnet: {
    rpcUrl: 'https://api.mainnet-beta.solana.com',
    wsUrl: 'wss://api.mainnet-beta.solana.com',
    name: 'Mainnet',
    description: 'Solana Mainnet'
  }
};

// Get current environment from localStorage or default to local
export const getCurrentEnvironment = (): string => {
  return localStorage.getItem('solana-environment') || 'local';
};

// Set current environment
export const setCurrentEnvironment = (env: string): void => {
  localStorage.setItem('solana-environment', env);
};

// Get current environment config
export const getCurrentEnvironmentConfig = (): EnvironmentConfig => {
  const currentEnv = getCurrentEnvironment();
  return environments[currentEnv] || environments.local;
};
