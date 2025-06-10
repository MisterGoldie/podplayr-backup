import React, { createContext, useState, useContext, ReactNode } from 'react';

interface ConnectionContextType {
  showConnectionHeader: boolean;
  setShowConnectionHeader: (show: boolean) => void;
  connectionUsername: string;
  setConnectionUsername: (username: string) => void;
  connectionLikedCount: number;
  setConnectionLikedCount: (count: number) => void;
}

const ConnectionContext = createContext<ConnectionContextType | undefined>(undefined);

export const ConnectionProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [showConnectionHeader, setShowConnectionHeader] = useState(false);
  const [connectionUsername, setConnectionUsername] = useState('');
  const [connectionLikedCount, setConnectionLikedCount] = useState(0);

  return (
    <ConnectionContext.Provider
      value={{
        showConnectionHeader,
        setShowConnectionHeader,
        connectionUsername,
        setConnectionUsername,
        connectionLikedCount,
        setConnectionLikedCount
      }}
    >
      {children}
    </ConnectionContext.Provider>
  );
};

export const useConnection = (): ConnectionContextType => {
  const context = useContext(ConnectionContext);
  if (context === undefined) {
    throw new Error('useConnection must be used within a ConnectionProvider');
  }
  return context;
};
