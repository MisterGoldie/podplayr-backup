'use client';

import React, { useEffect, useRef } from 'react';

interface PrivacyPolicyModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const PrivacyPolicyModal: React.FC<PrivacyPolicyModalProps> = ({ isOpen, onClose }) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[120] pointer-events-none">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm pointer-events-auto"
        onClick={onClose}
      />

      <div
        className="absolute inset-x-0 flex items-center justify-center px-4 pointer-events-none"
        style={{
          top: '4.75rem',
          bottom: 'calc(10.75rem + env(safe-area-inset-bottom, 0px))',
        }}
      >
        <div className="relative bg-gray-900/95 backdrop-blur-lg rounded-3xl overflow-hidden shadow-2xl shadow-purple-900/40 border border-purple-400/30 w-full max-w-md max-h-full min-h-0 flex flex-col pointer-events-auto">
          <div className="relative flex-shrink-0 px-5 pt-5 pb-3">
            <button
              type="button"
              onClick={onClose}
              className="absolute top-3 right-3 z-10 text-white/80 hover:text-white active:scale-95 transition-all p-2 touch-manipulation rounded-full bg-black/50 backdrop-blur-sm border border-white/10"
              aria-label="Close"
            >
              <svg xmlns="http://www.w3.org/2000/svg" height="20" viewBox="0 -960 960 960" width="20" fill="currentColor">
                <path d="M480-424 284-228q-11 11-28 11t-28-11q-11-11-11-28t11-28l196-196-196-196q-11-11-11-28t11-28q11-11 28-11t28 11l196 196 196-196q11 11 28-11t28 11q11 11 11 28t-11 28L536-480l196 196q11 11 11 28t-11 28q-11 11-28 11t-28-11L480-424Z" />
              </svg>
            </button>
            <h2 className="text-white text-lg font-semibold leading-snug tracking-tight pr-10">
              Privacy Policy
            </h2>
            <p className="mt-1 text-sm text-white/45">PODPLAYR · Effective April 18, 2025</p>
          </div>

          <div
            ref={scrollRef}
            className="px-5 pb-5 min-h-0 flex-1 overflow-y-auto overscroll-contain touch-pan-y"
            style={{
              WebkitOverflowScrolling: 'touch',
              scrollbarWidth: 'thin',
              scrollbarColor: 'rgba(168, 85, 247, 0.4) rgba(0, 0, 0, 0.2)',
            }}
          >
            <div className="text-left text-sm text-white/70 leading-relaxed space-y-4">
              <p>
                POD, LLC ("PODPLAYR," "we," "us," or "our") respects your privacy and is committed to protecting it through our compliance with this Privacy Policy. This Policy describes how we collect, use, disclose, retain, and protect your information when you access or use the PODPLAYR platform (the "Service").
              </p>

              <p>
                By accessing or using the Service, you acknowledge that you have read and understood this Privacy Policy and agree to the collection and use of your information in accordance with it.
              </p>

              <h3 className="text-white font-semibold mt-2">1. Information We Collect</h3>
              <p>We collect the following types of information:</p>

              <h4 className="text-purple-200/90 font-medium">(a) Wallet-Linked and Blockchain Data:</h4>
              <ul className="list-disc pl-5 space-y-1">
                <li>Public wallet address and associated NFT/token holdings (on-chain lookups only).</li>
                <li>Transaction histories, balances, and interactions with the Service linked to your wallet address.</li>
              </ul>

              <h4 className="text-purple-200/90 font-medium">(b) Technical and Usage Data:</h4>
              <ul className="list-disc pl-5 space-y-1">
                <li>IP address, browser type, device information, operating system, and access times.</li>
                <li>Log data, page views, clicks, and session duration.</li>
                <li>Metadata about NFT content streamed, viewed, or shared.</li>
              </ul>

              <h4 className="text-purple-200/90 font-medium">(c) Optional Profile and Account Data (if applicable):</h4>
              <ul className="list-disc pl-5 space-y-1">
                <li>Display name, avatar, bio, preferences, linked social handles.</li>
              </ul>

              <h4 className="text-purple-200/90 font-medium">(d) Communication and Feedback Data:</h4>
              <ul className="list-disc pl-5 space-y-1">
                <li>Customer support messages, surveys, bug reports, and user-submitted feedback.</li>
              </ul>

              <h3 className="text-white font-semibold">2. How We Use Information</h3>
              <p>Your data is used to:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Operate, maintain, and improve the functionality of the Service.</li>
                <li>Personalize content and advertising based on interaction history.</li>
                <li>Detect and prevent fraudulent activity, abuse, or security breaches.</li>
                <li>Comply with legal and regulatory obligations.</li>
                <li>Communicate with users for service-related updates.</li>
              </ul>
              <p>
                We may also use anonymized and aggregated data for statistical, research, or commercial purposes.
              </p>

              <h3 className="text-white font-semibold">3. Disclosure of Information</h3>
              <p>
                We do not sell your personal information. However, we may disclose or share information about you under the following limited circumstances:
              </p>

              <h4 className="text-purple-200/90 font-medium">(a) Service Providers and Contractors:</h4>
              <p>
                We may disclose personal information to trusted third-party service providers and contractors who perform services on our behalf, such as cloud hosting, data analytics, technical support, customer service, marketing assistance, or security monitoring. These parties are contractually obligated to use your information only as necessary to provide services to us and are prohibited from using or disclosing it for any other purpose.
              </p>

              <h4 className="text-purple-200/90 font-medium">(b) Legal Obligations and Government Requests:</h4>
              <p>
                We may disclose your information if required to do so by law or in good faith belief that such action is necessary to:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Comply with a legal obligation, court order, or subpoena.</li>
                <li>Cooperate with regulatory investigations or law enforcement inquiries.</li>
                <li>Protect and defend our rights, interests, or property, or that of our users or others.</li>
                <li>Prevent or investigate possible wrongdoing in connection with the Service.</li>
                <li>Enforce our Terms of Service, or protect against legal liability.</li>
              </ul>

              <h4 className="text-purple-200/90 font-medium">(c) Business Transfers:</h4>
              <p>
                If PODPLAYR is involved in a merger, acquisition, reorganization, sale of assets, or bankruptcy proceeding, your information may be transferred or disclosed as part of that transaction. You will be notified by email and/or a prominent notice on our Service if such a transaction materially affects the way your information is handled.
              </p>

              <h4 className="text-purple-200/90 font-medium">(d) Affiliates and Corporate Group:</h4>
              <p>
                We may disclose your information to our current or future affiliates, subsidiaries, or other related entities that are under common control or ownership, provided they are subject to this Privacy Policy or privacy protections that are at least as protective.
              </p>

              <h4 className="text-purple-200/90 font-medium">(e) Aggregated and De-Identified Information:</h4>
              <p>
                We may share aggregated, anonymized, or de-identified data that cannot reasonably be used to identify you. This information may be used for industry analysis, research, marketing, or other business purposes.
              </p>

              <h4 className="text-purple-200/90 font-medium">(f) With Your Consent:</h4>
              <p>
                We may disclose your personal information to third parties when we have obtained your explicit consent to do so, such as in connection with integrations with external platforms (e.g., wallets, marketplaces) or participation in promotional activities.
              </p>

              <p>
                In all cases, we limit disclosure to the minimum necessary to achieve the intended purpose and ensure, where applicable, that recipients are bound by confidentiality and data protection obligations consistent with this Privacy Policy and applicable laws.
              </p>

              <h3 className="text-white font-semibold">4. Use of Public Blockchain Data</h3>
              <p>
                As a Web3-native platform, PODPLAYR interacts with public blockchains such as Ethereum and other decentralized networks. These blockchains are by design transparent and immutable. Any data recorded on a public blockchain—including your wallet address, transactions, token or NFT ownership, and interaction history—is publicly accessible and cannot be altered or deleted by us.
              </p>
              <p>
                We do not collect or store your private keys, and we never have access to your crypto assets. However, we may read and process publicly available blockchain data for the following purposes:
              </p>
              <ul className="list-disc pl-5 space-y-1">
                <li>To facilitate the delivery of core platform functionality, including playback of NFTs associated with your wallet address.</li>
                <li>To identify, aggregate, and analyze ownership of digital media content streamed via PODPLAYR.</li>
                <li>To support search, display, and content personalization features.</li>
                <li>To prevent abuse, enforce security measures, and support compliance checks.</li>
              </ul>
              <p>
                We may also associate publicly visible wallet activity with non-wallet user data (such as IP address, browser metadata, or account preferences) for personalization, analytics, and platform enhancement purposes. Where this occurs, we treat that associated data as personal data, subject to the rest of this Privacy Policy.
              </p>
              <p>
                It is important to understand that we cannot erase, modify, or restrict access to data stored on decentralized public networks. If you are concerned about the privacy implications of blockchain technology, you should carefully evaluate the risks before linking a wallet to the Service.
              </p>

              <h3 className="text-white font-semibold">5. Cookies and Tracking Technologies</h3>
              <p>
                We use a variety of tracking technologies—including cookies, local storage, web beacons, and similar tools—to collect and store certain information about your interaction with the Service. These technologies help us deliver essential functionality, analyze usage patterns, and improve overall user experience.
              </p>

              <h4 className="text-purple-200/90 font-medium">(a) Types of Tracking Technologies We Use:</h4>
              <ul className="list-disc pl-5 space-y-1">
                <li>Strictly Necessary Cookies: These are required for the operation of the Service and include technologies that enable you to log in, navigate pages, and access secure areas.</li>
                <li>Functional Cookies: These enable us to remember choices you make, such as your region or language, and provide enhanced functionality.</li>
                <li>Performance and Analytics Cookies: These collect aggregated data on how users interact with the Service, including which pages are visited most often. This data helps us improve performance and design.</li>
                <li>Targeting or Advertising Cookies: These may be set by us or third-party advertising partners to build a profile of your interests and show you relevant advertisements across other sites or services.</li>
              </ul>

              <h3 className="text-white font-semibold">6. Data Retention</h3>
              <p>
                We retain personal data for as long as it is necessary to fulfill the purposes for which it was collected, as outlined in this Privacy Policy, unless a longer or shorter retention period is required or permitted by applicable law.
              </p>

              <h3 className="text-white font-semibold">7. Data Security</h3>
              <p>
                We take the security of your personal data seriously and are committed to safeguarding it through the implementation of appropriate technical, administrative, and organizational measures. These measures are designed to protect your information against accidental loss, unauthorized access, disclosure, alteration, misuse, or destruction.
              </p>

              <h3 className="text-white font-semibold">8. Children's Privacy</h3>
              <p>
                The Service is not directed at children under 13 (or 16 in some jurisdictions). We do not knowingly collect personal data from children. If we learn that a child has submitted personal information, we will take steps to delete it.
              </p>

              <h3 className="text-white font-semibold">9. User Rights and Controls</h3>
              <p>Depending on your jurisdiction, you may have rights under data protection laws, including:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Accessing your information.</li>
                <li>Correcting inaccurate or incomplete data.</li>
                <li>Requesting deletion of your data.</li>
                <li>Objecting to processing or limiting use.</li>
                <li>Porting your data to another service.</li>
              </ul>
              <p>
                To exercise these rights, contact us at{' '}
                <a href="mailto:dan41085@gmail.com" className="text-purple-300 underline underline-offset-2">
                  dan41085@gmail.com
                </a>
                . We may request identity verification.
              </p>

              <h3 className="text-white font-semibold">10. International Users and Data Transfers</h3>
              <p>
                Our servers may be located in the United States or other jurisdictions where data protection laws may differ from those of your country of residence. By using the Service, you consent to the transfer, storage, and processing of your information in such countries.
              </p>

              <h3 className="text-white font-semibold">11. Third-Party Services and Links</h3>
              <p>
                The PODPLAYR Service may contain links to or integrations with third-party services, platforms, tools, and applications—including but not limited to Farcaster, blockchain wallet providers, NFT marketplaces, content hosts, social platforms, analytics vendors, and advertising networks (collectively, "Third-Party Services"). These Third-Party Services operate independently of PODPLAYR and may have their own privacy policies and terms of use.
              </p>

              <h3 className="text-white font-semibold">12. Updates to This Policy</h3>
              <p>
                We may revise this Privacy Policy at any time. Changes are effective upon posting. We will notify you of material changes via the Service or by email, if applicable.
              </p>

              <h3 className="text-white font-semibold">13. Contact Us</h3>
              <p>If you have questions or concerns about our data practices, contact us at:</p>
              <p>
                Email:{' '}
                <a href="mailto:dan41085@gmail.com" className="text-purple-300 underline underline-offset-2">
                  dan41085@gmail.com
                </a>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicyModal;
