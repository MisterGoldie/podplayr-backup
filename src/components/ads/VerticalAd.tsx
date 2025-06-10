import React from 'react';
import styles from './VerticalAd.module.css';

interface VerticalAdProps {
  adContent: React.ReactNode;
  className?: string;
}

export const VerticalAd: React.FC<VerticalAdProps> = ({ adContent, className = '' }) => {
  return (
    <div className={`h-full flex flex-col items-center justify-start ${className}`}>
      <div className="w-full h-full flex flex-col items-center">
        {adContent}
      </div>
    </div>
  );
}; 