import { SearchBar } from '../search/SearchBar';

interface TopNavProps {
  currentPage: {
    isHome: boolean;
    isExplore: boolean;
    isLibrary: boolean;
    isProfile: boolean;
  };
  handleSearch: (username: string) => void;
  isSearching: boolean;
}

export const TopNav: React.FC<TopNavProps> = ({ currentPage, handleSearch, isSearching }) => {
  return (
    <div className="sticky top-0 z-50 bg-black/90 backdrop-blur-lg border-b border-purple-500/20">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-purple-400 font-mono">
            {currentPage.isHome ? 'Home' : 
             currentPage.isExplore ? 'Explore' : 
             currentPage.isLibrary ? 'Library' : 'Profile'}
          </h1>
          {currentPage.isExplore && (
            <SearchBar onSearch={handleSearch} isSearching={isSearching} />
          )}
        </div>
      </div>
    </div>
  );
}; 