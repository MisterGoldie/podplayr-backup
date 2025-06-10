'use client';

import React, { useEffect, useRef, useState } from 'react';

// This component acts as a circuit breaker for render loops
// It will detect if too many renders happen in a short time and
// break the circuit to prevent infinite loops

interface RenderProtectionProps {
  children: React.ReactNode;
  maxRendersPerSecond?: number;  // Maximum number of renders allowed per second
  timeWindowMs?: number;         // Time window to count renders in milliseconds
  enabled?: boolean;             // Toggle protection on/off
}

export const RenderProtection: React.FC<RenderProtectionProps> = ({ 
  children, 
  maxRendersPerSecond = 30,      // Default: 30 renders per second is too many
  timeWindowMs = 1000,           // Default: Check over a 1 second window
  enabled = true,                // Default: Protection is on
}) => {
  // Skip in production since it adds overhead
  if (process.env.NODE_ENV === 'production' || !enabled) {
    return <>{children}</>;
  }

  return <InternalRenderProtection 
    maxRendersPerSecond={maxRendersPerSecond}
    timeWindowMs={timeWindowMs}
  >
    {children}
  </InternalRenderProtection>;
};

// Internal component that does the actual work
// Wrapped to avoid re-renders of the check itself
const InternalRenderProtection: React.FC<Omit<RenderProtectionProps, 'enabled'>> = ({
  children,
  maxRendersPerSecond,
  timeWindowMs,
}) => {
  // Track if we've broken the circuit
  const [circuitBroken, setCircuitBroken] = useState(false);
  // Reference to avoid re-renders affecting the tracking
  const renderTimesRef = useRef<number[]>([]);
  
  // Detect render loops
  useEffect(() => {
    // This effect runs on every render
    const now = Date.now();
    renderTimesRef.current.push(now);
    
    // Only keep timestamps within our time window
    const cutoff = now - timeWindowMs!;
    renderTimesRef.current = renderTimesRef.current.filter(time => time >= cutoff);
    
    // Calculate renders per second
    const rendersInWindow = renderTimesRef.current.length;
    const rendersPerSecond = rendersInWindow / (timeWindowMs! / 1000);
    
    // If too many renders, break the circuit
    if (rendersPerSecond > maxRendersPerSecond! && !circuitBroken) {
      console.error(`🚨 RENDER LOOP DETECTED: ${rendersPerSecond.toFixed(1)} renders/second`);
      console.error('Breaking the render circuit to prevent infinite loop');
      setCircuitBroken(true);
    }
    
    // Log every 10 renders just to monitor
    if (rendersInWindow % 10 === 0) {
      console.log(`Current render rate: ${rendersPerSecond.toFixed(1)} renders/second`);
    }
  }, [maxRendersPerSecond, timeWindowMs, circuitBroken]);
  
  // If circuit broken, show error and stop rendering children
  if (circuitBroken) {
    return (
      <div style={{ 
        padding: '20px', 
        margin: '20px', 
        backgroundColor: '#ffdddd', 
        border: '2px solid red',
        borderRadius: '8px',
        color: '#d00000',
        fontFamily: 'system-ui, -apple-system, sans-serif'
      }}>
        <h2>⚠️ Render Loop Detected</h2>
        <p>A render loop was detected and has been stopped to prevent your browser from crashing.</p>
        <p>This often happens when state updates trigger additional state updates in an infinite cycle.</p>
        <p>Check your React component effects and state updates.</p>
        <button 
          onClick={() => window.location.reload()} 
          style={{ 
            padding: '8px 16px', 
            backgroundColor: '#d00000', 
            color: 'white', 
            border: 'none', 
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          Reload Page
        </button>
      </div>
    );
  }
  
  // Render normally if no issues detected
  return <>{children}</>;
};
