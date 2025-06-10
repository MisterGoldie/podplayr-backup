import React from 'react';

interface TermsOfServiceProps {
  onAccept: () => void;
}

const TermsOfService: React.FC<TermsOfServiceProps> = ({ onAccept }) => {
  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col items-center justify-center p-4 overflow-y-auto">
      <div className="w-full max-w-lg bg-gray-900 rounded-lg border border-purple-500/30 shadow-xl p-6 max-h-[80vh] overflow-y-auto">
        <h1 className="text-2xl font-bold text-green-400 mb-4 font-mono text-center">Terms of Service</h1>
        
        <div className="text-gray-300 space-y-4 mb-6 text-sm">
          <p>
            Welcome to PODPLAYR! By using our dApp, you agree to these Terms of Service.
          </p>
          
          <h2 className="text-lg text-purple-300 font-medium mt-4">1. Introduction</h2>
          <p>
            Welcome to the NFT Media Player ("Service", "we", "us", or "our"). By accessing or using our Service, you agree to be bound by these Terms of Service ("Terms"). If you disagree with any part of these Terms, you may not access the Service.
          </p>
          
          <h2 className="text-lg text-purple-300 font-medium mt-4">2. Description of Service</h2>
          <p>
            The NFT Media Player is a platform that allows users to connect their wallet, discover, play, and share audio content contained within Non-Fungible Tokens (NFTs) they own or have access to. Our Service does not host, store, or distribute NFT content directly but rather provides an interface to access such content that exists on various blockchain networks.
          </p>
          
          <h2 className="text-lg text-purple-300 font-medium mt-4">3. User Representations and Warranties</h2>
          <p>
            By using our Service, you represent and warrant that:
          </p>
          <p>
            You have the right and authority to access and play the NFTs displayed through our Service.
          </p>
          <p>
            You understand that all content accessed through our Service is owned by its respective creators and rights holders.
          </p>
          <p>
            You will not use our Service to infringe upon the intellectual property rights of others.
          </p>
          
          <h2 className="text-lg text-purple-300 font-medium mt-4">4. Content Ownership and Rights</h2>
          <p>
            4.1 NFT Content
          </p>
          <p>
            Our Service does not claim ownership over any NFT content displayed or played. All rights to NFT content remain with the original creators, rights holders, or as specified in the smart contracts governing each NFT.
          </p>
          <p>
            4.2 Playback Service
          </p>
          <p>
            We provide a playback service for NFT content that users already own or have access to. We do not modify, alter, or create derivative works from the original NFT content.
          </p>
          
          <h2 className="text-lg text-purple-300 font-medium mt-4">5. Disclaimer of Warranties</h2>
          <p>
            THE SERVICE IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.
          </p>
          <p>
            We do not warrant that:
          </p>
          <p>
            The Service will be available at all times or function without interruptions or errors
          </p>
          <p>
            Content accessible through our Service is free from copyright infringement or other legal issues
          </p>
          <p>
            The Service will meet your specific requirements or expectations.
          </p>
          
          <h2 className="text-lg text-purple-300 font-medium mt-4">6. Limitation of Liability</h2>
          <p>
            TO THE FULLEST EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT WILL WE BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, INCLUDING WITHOUT LIMITATION, LOSS OF PROFITS, DATA, USE, GOODWILL, OR OTHER INTANGIBLE LOSSES, RESULTING FROM:
          </p>
          <p>
            Your access to or use of (or inability to access or use) the Service
          </p>
          <p>
            Any content obtained from the Service, including but not limited to audio content from NFTs
          </p>
          <p>
            Unauthorized access, use, or alteration of your data or NFTs
          </p>
          <p>
            Any claims related to copyright or other intellectual property infringement arising from content accessed through our Service
          </p>
          <p>
            Our total liability for any claims under these Terms shall not exceed $100.
          </p>
          
          <h2 className="text-lg text-purple-300 font-medium mt-4">7. Indemnification</h2>
          <p>
            You agree to indemnify, defend, and hold harmless our Service, its affiliates, officers, directors, employees, consultants, and agents from and against any and all claims, liabilities, damages, losses, costs, expenses, and fees (including reasonable attorneys' fees) that arise from or relate to:
          </p>
          <p>
            Your use or misuse of our Service
          </p>
          <p>
            Your violation of these Terms
          </p>
          <p>
            Your violation of any rights of others, including intellectual property rights
          </p>
          <p>
            Your access to and playback of NFT content through our Service
          </p>
          
          <h2 className="text-lg text-purple-300 font-medium mt-4">8. DMCA and Copyright Policy</h2>
          <p>
            We respect the intellectual property rights of others and expect users of our Service to do the same. If you believe that content accessible through our Service infringes your copyright, please contact us with the following information:
          </p>
          <p>
            A description of the copyrighted work you claim has been infringed
          </p>
          <p>
            The location on our Service where the allegedly infringing content is located
          </p>
          <p>
            Your contact information
          </p>
          <p>
            A statement by you that you have a good faith belief that the disputed use is not authorized
          </p>
          <p>
            A statement, made under penalty of perjury, that the above information is accurate and that you are the copyright owner or authorized to act on behalf of the copyright owner.
          </p>
          
          <h2 className="text-lg text-purple-300 font-medium mt-4">9. Governing Law</h2>
          <p>
            These Terms shall be governed by and construed in accordance with the laws of [YOUR JURISDICTION], without regard to its conflict of law provisions.
          </p>
          
          <h2 className="text-lg text-purple-300 font-medium mt-4">10. Changes to Terms</h2>
          <p>
            We reserve the right to modify or replace these Terms at any time. If a revision is material, we will provide at least 30 days' notice prior to any new terms taking effect. What constitutes a material change will be determined at our sole discretion.
          </p>
        </div>
        
        <div className="flex justify-center mt-6">
          <button 
            onClick={onAccept}
            onTouchEnd={(e) => {
              e.preventDefault(); // Prevent default touch behavior
              onAccept();
            }}
            className="bg-purple-600 hover:bg-purple-700 active:bg-purple-800 text-white font-bold py-4 px-10 rounded-full transition-colors duration-300 shadow-lg shadow-purple-600/30 touch-manipulation text-lg"
            style={{ WebkitTapHighlightColor: 'transparent' }} // Remove tap highlight on iOS
          >
            I Accept the Terms of Service
          </button>
        </div>
      </div>
    </div>
  );
};

export default TermsOfService;