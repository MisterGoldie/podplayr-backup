import { useContext } from 'react';
import { FarcasterContext } from '../../app/providers';
import UserDropdownMenu from '../auth/UserDropdownMenu';

type View = 'home' | 'explore' | 'library' | 'profile';

interface BottomNavProps {
  currentView: View;
  onViewChange: (view: View) => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({ currentView, onViewChange }) => {
  const { isFarcaster } = useContext(FarcasterContext);

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-md border-t border-green-400/30">
      <div className="flex items-center justify-around p-4">
        <button
          onClick={() => onViewChange('home')}
          className={`flex flex-col items-center p-2 ${
            currentView === 'home' ? 'text-green-400' : 'text-gray-400'
          }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24" fill="currentColor">
            <path d="M240-200h120v-240h240v240h120v-360L480-740 240-560v360Zm-80 80v-480l320-240 320 240v480H520v-240h-80v240H160Zm320-350Z"/>
          </svg>
          <span className="text-sm mt-1">Home</span>
        </button>

        <button
          onClick={() => onViewChange('explore')}
          className={`flex flex-col items-center p-2 ${
            currentView === 'explore' ? 'text-green-400' : 'text-gray-400'
          }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24" fill="currentColor">
            <path d="M784-160 532-412q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-620q0-109 75.5-184.5T380-880q109 0 184.5 75.5T640-620q0 44-14 83t-38 69l252 252-56 56ZM380-400q92 0 156-64t64-156q0-92-64-156t-156-64q-92 0-156 64t-64 156q0 92 64 156t156 64Z"/>
          </svg>
          <span className="text-sm mt-1">Explore</span>
        </button>

        <button
          onClick={() => onViewChange('library')}
          className={`flex flex-col items-center p-2 ${
            currentView === 'library' ? 'text-green-400' : 'text-gray-400'
          }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24" fill="currentColor">
            <path d="m480-240 160-160-160-160v320ZM320-280v-400l240 200-240 200Zm160-120Z"/>
          </svg>
          <span className="text-sm mt-1">Library</span>
        </button>

        {!isFarcaster && (
          <div
            onClick={() => onViewChange('profile')}
            className={`flex flex-col items-center p-2 ${
              currentView === 'profile' ? 'text-green-400' : 'text-gray-400'
            }`}
          >
            <UserDropdownMenu />
            <span className="text-sm mt-1">Profile</span>
          </div>
        )}
      </div>
    </nav>
  );
};