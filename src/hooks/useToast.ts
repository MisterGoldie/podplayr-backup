import { toast as hotToast } from 'react-hot-toast';

export const useToast = () => {
  const success = (message: string) => {
    hotToast.success(message, {
      style: {
        background: '#1a1a1a',
        color: '#fff',
        borderRadius: '8px',
        border: '1px solid rgba(255, 255, 255, 0.1)',
      },
      duration: 3000,
    });
  };

  const error = (message: string) => {
    hotToast.error(message, {
      style: {
        background: '#1a1a1a',
        color: '#fff',
        borderRadius: '8px',
        border: '1px solid rgba(255, 255, 255, 0.1)',
      },
      duration: 4000,
    });
  };

  return {
    success,
    error,
  };
};
