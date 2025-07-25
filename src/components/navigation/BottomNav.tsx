import { useContext } from 'react';
import { FarcasterContext } from '../../app/providers';
import { motion } from 'framer-motion';

type View = 'home' | 'explore' | 'library' | 'profile';

interface BottomNavProps {
  currentView: View;
  onViewChange: (view: View) => void;
  isPlayerActive?: boolean;
}

const buttonVariants = {
  tap: { scale: 0.95 },
  hover: { scale: 1.05 }
};

export const BottomNav: React.FC<BottomNavProps> = ({ currentView, onViewChange, isPlayerActive }) => {
  return (
    <nav className="fixed bottom-0 left-0 right-0 z-[110] bg-black/90 backdrop-blur-lg border-t border-purple-500/20 transition-all duration-300">
      <div className="flex justify-around items-center py-2">
        <motion.button
          variants={buttonVariants}
          whileTap="tap"
          whileHover="hover"
          onClick={() => onViewChange('home')}
          className={`flex flex-col items-center p-2 transition-colors duration-200 ${
            currentView === 'home' ? 'text-purple-400' : 'text-gray-400'
          }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24" fill="currentColor">
            <path d="M240-200h120v-240h240v240h120v-360L480-740 240-560v360Zm-80 80v-480l320-240 320 240v480H520v-240h-80v240H160Zm320-350Z"/>
          </svg>
          <span className="text-sm mt-1">Home</span>
        </motion.button>

        <motion.button
          variants={buttonVariants}
          whileTap="tap"
          whileHover="hover"
          onClick={() => onViewChange('explore')}
          className={`flex flex-col items-center p-2 transition-colors duration-200 ${
            currentView === 'explore' ? 'text-purple-400' : 'text-gray-400'
          }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24" fill="currentColor">
            <path d="M784-160 532-412q-30 24-69 38t-83 14q-109 0-184.5-75.5T120-620q0-109 75.5-184.5T380-880q109 0 184.5 75.5T640-620q0 44-14 83t-38 69l252 252-56 56ZM380-400q92 0 156-64t64-156q0-92-64-156t-156-64q-92 0-156 64t-64 156q0 92 64 156t156 64Z"/>
          </svg>
          <span className="text-sm mt-1">Explore</span>
        </motion.button>

        <motion.button
          variants={buttonVariants}
          whileTap="tap"
          whileHover="hover"
          onClick={() => onViewChange('library')}
          className={`flex flex-col items-center p-2 transition-colors duration-200 ${
            currentView === 'library' ? 'text-purple-400' : 'text-gray-400'
          }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24" fill="currentColor">
            <path d="M120-240v-80h720v80H120Zm0-200v-80h720v80H120Zm0-200v-80h720v80H120Z"/>
          </svg>
          <span className="text-sm mt-1">Library</span>
        </motion.button>

        <motion.button
          variants={buttonVariants}
          whileTap="tap"
          whileHover="hover"
          onClick={() => onViewChange('profile')}
          className={`flex flex-col items-center p-2 transition-colors duration-200 ${
            currentView === 'profile' ? 'text-purple-400' : 'text-gray-400'
          }`}
        >
          <svg xmlns="http://www.w3.org/2000/svg" height="24" viewBox="0 -960 960 960" width="24" fill="currentColor">
            <path d="M480-480q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47ZM160-160v-112q0-34 17.5-62.5T224-378q62-31 126-46.5T480-440q66 0 130 15.5T736-378q29 15 46.5 43.5T800-272v112H160Zm80-80h480v-32q0-11-5.5-20T700-306q-54-27-109-40.5T480-360q-56 0-111 13.5T260-306q-9 5-14.5 14t-5.5 20v32Zm240-320q33 0 56.5-23.5T560-640q0-33-23.5-56.5T480-720q-33 0-56.5 23.5T400-640q0 33 23.5 56.5T480-560Zm0-80Zm0 400Z"/>
          </svg>
          <span className="text-sm mt-1">Profile</span>
        </motion.button>
      </div>
    </nav>
  );
};