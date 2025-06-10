// Ensure the ad container properly fills vertical space
export const AdContainer: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <div className="h-full flex flex-col items-center justify-start p-0 m-0 overflow-hidden">
      {children}
    </div>
  );
}; 