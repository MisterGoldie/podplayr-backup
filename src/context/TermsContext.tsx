import React, { createContext, useContext, useState, useEffect } from 'react';
import { FarcasterContext, UserFidContext } from '../app/providers';

interface TermsContextType {
  hasAcceptedTerms: boolean;
  acceptTerms: () => void;
}

const TermsContext = createContext<TermsContextType>({
  hasAcceptedTerms: false,
  acceptTerms: () => {},
});

export const useTerms = () => useContext(TermsContext);

interface TermsProviderProps {
  children: React.ReactNode;
}

export const TermsProvider: React.FC<TermsProviderProps> = ({ children }) => {
  const [hasAcceptedTerms, setHasAcceptedTerms] = useState<boolean>(false);
  
  // Get the current user's FID from context
  const { fid } = useContext(UserFidContext);
  
  // Check localStorage on mount to see if user has already accepted terms
  useEffect(() => {
    const termsAccepted = localStorage.getItem('podplayr_terms_accepted');
    if (termsAccepted === 'true') {
      setHasAcceptedTerms(true);
    }
  }, []);
  
  const acceptTerms = () => {
    localStorage.setItem('podplayr_terms_accepted', 'true');
    setHasAcceptedTerms(true);
  };
  
  return (
    <TermsContext.Provider value={{ 
      hasAcceptedTerms,
      acceptTerms 
    }}>
      {children}
    </TermsContext.Provider>
  );
};
//