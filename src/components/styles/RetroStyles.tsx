import React from 'react';
import { Global, css } from '@emotion/react';

const retroStyles = css`
  .retro-container {
    border: 2px solid #444;
    box-shadow: 
      inset 0 0 20px rgba(0,0,0,0.5),
      0 2px 8px rgba(0,0,0,0.3);
    transition: all 0.3s ease-in-out;
  }

  .retro-container:not([class*='rounded-t-']) {
    border-radius: 10px;
  }

  .retro-container[class*='rounded-t-'] {
    border-bottom: none;
    border-left: none;
    border-right: none;
    border-top: 1px solid #444;
  }

  .retro-container.playing {
    border-color: #22c55e40;
    box-shadow: 
      inset 0 0 20px rgba(34,197,94,0.1),
      0 2px 8px rgba(34,197,94,0.1);
  }

  /* Rest of the retro styles... */
`;

export const RetroStyles: React.FC = () => (
  <Global styles={retroStyles} />
); 