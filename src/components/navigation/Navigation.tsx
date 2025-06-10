import { useContext } from 'react';
import { FarcasterContext } from '../../app/providers';
import UserDropdownMenu from '../auth/UserDropdownMenu';

export const Navigation = () => {
  const { isFarcaster } = useContext(FarcasterContext);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-black/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex">
            <div className="flex-shrink-0 flex items-center">
              <a href="/" className="text-white font-bold text-xl">
                PODPlayr
              </a>
            </div>
          </div>
          <div className="flex items-center">
            {!isFarcaster && <UserDropdownMenu />}
          </div>
        </div>
      </div>
    </nav>
  );
};