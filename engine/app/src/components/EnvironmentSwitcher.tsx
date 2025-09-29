import React, { useState, useEffect } from 'react';
import { environments, getCurrentEnvironment, setCurrentEnvironment, getCurrentEnvironmentConfig } from '../config/environments';
import type { EnvironmentConfig } from '../config/environments';

interface EnvironmentSwitcherProps {
  onEnvironmentChange: (config: EnvironmentConfig) => void;
}

const EnvironmentSwitcher: React.FC<EnvironmentSwitcherProps> = ({ onEnvironmentChange }) => {
  const [currentEnv, setCurrentEnv] = useState<string>(getCurrentEnvironment());
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const config = getCurrentEnvironmentConfig();
    onEnvironmentChange(config);
  }, [currentEnv, onEnvironmentChange]);

  const handleEnvironmentChange = (envKey: string) => {
    setCurrentEnvironment(envKey);
    setCurrentEnv(envKey);
    setIsOpen(false);
  };

  const currentConfig = environments[currentEnv];

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="terminal-button text-xs bg-blue-600 hover:bg-blue-500 flex items-center space-x-2"
      >
        <span>🌐 {currentConfig.name}</span>
        <span className="text-xs opacity-75">{isOpen ? '▲' : '▼'}</span>
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 mt-2 w-64 bg-gray-900 border border-gray-600 rounded shadow-lg z-50">
          <div className="p-2">
            <div className="text-xs terminal-output mb-2">Select Environment:</div>
            {Object.entries(environments).map(([key, config]) => (
              <button
                key={key}
                onClick={() => handleEnvironmentChange(key)}
                className={`w-full text-left p-2 rounded text-xs transition-colors ${
                  currentEnv === key
                    ? 'bg-green-900 bg-opacity-50 border border-green-400'
                    : 'hover:bg-gray-800 border border-transparent'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="terminal-success font-bold">{config.name}</div>
                    <div className="terminal-output text-xs opacity-75">{config.description}</div>
                  </div>
                  {currentEnv === key && (
                    <span className="terminal-success text-xs">✓</span>
                  )}
                </div>
                <div className="terminal-output text-xs mt-1 opacity-60">
                  {config.rpcUrl}
                </div>
              </button>
            ))}
          </div>
          <div className="border-t border-gray-600 p-2">
            <div className="text-xs terminal-output">
              Current: <span className="terminal-success">{currentConfig.rpcUrl}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EnvironmentSwitcher;
