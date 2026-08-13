import type { NFT } from '../types/user';

export type NftChain = 'ethereum' | 'base';

export function normalizeNftChain(network?: string | number | null): NftChain | null {
  if (network === undefined || network === null || network === '') return null;
  const value = String(network).toLowerCase().trim();
  if (value === 'base' || value === 'base-mainnet' || value === '8453') return 'base';
  if (
    value === 'ethereum' ||
    value === 'eth' ||
    value === 'eth-mainnet' ||
    value === 'mainnet' ||
    value === '1'
  ) {
    return 'ethereum';
  }
  return null;
}

/** Collapse `0x0xabc` / `0X0xabc` into a single 0x prefix. */
function stripHexPrefix(value: string): string {
  return value.replace(/^(0x)+/i, '');
}

export function toDecimalTokenId(tokenId?: string | number | null): string {
  if (tokenId === undefined || tokenId === null || tokenId === '') return '';
  const raw = String(tokenId).trim();
  if (/^\d+$/.test(raw)) return raw;

  const stripped = stripHexPrefix(raw);
  if (!stripped || !/^[0-9a-f]+$/i.test(stripped)) return '';

  // Decimal that was stored with a useless 0x prefix
  if (/^\d+$/.test(stripped) && !/[a-f]/i.test(stripped)) {
    return stripped.replace(/^0+/, '') || '0';
  }

  try {
    return BigInt(`0x${stripped}`).toString(10);
  } catch {
    return '';
  }
}

export function normalizeContractAddress(contract?: string | null): string {
  if (!contract) return '';
  const trimmed = contract.trim();
  const withPrefix = trimmed.startsWith('0x') || trimmed.startsWith('0X') ? trimmed : `0x${trimmed}`;
  return withPrefix.toLowerCase();
}

/**
 * Some stored token IDs are a truncated contract (`0x0xccf50ef6` for
 * 0xccf50ef6…). Those 404 on /nft/{contract}/{id}.
 */
function tokenIdLooksLikeContractFragment(tokenId: string | undefined, contract: string): boolean {
  if (!tokenId) return false;
  const hex = stripHexPrefix(String(tokenId).trim()).toLowerCase();
  const addr = stripHexPrefix(contract).toLowerCase();
  return hex.length >= 6 && hex.length <= 16 && addr.startsWith(hex);
}

/**
 * Explorer link for the info panel.
 * Unknown chain defaults to Base so we never show Etherscan for an untagged Base NFT.
 */
export function getNftExplorerLinks(nft: NFT) {
  const chain = normalizeNftChain(nft.network) ?? 'base';
  const contract = normalizeContractAddress(nft.contract);
  const contractValid = Boolean(contract && /^0x[a-f0-9]{40}$/.test(contract));
  const tokenId = tokenIdLooksLikeContractFragment(nft.tokenId, contract)
    ? ''
    : toDecimalTokenId(nft.tokenId);

  const explorerName = chain === 'base' ? 'Basescan' : 'Etherscan';
  const origin = chain === 'base' ? 'https://basescan.org' : 'https://etherscan.io';
  const explorerUrl = contractValid
    ? (tokenId ? `${origin}/nft/${contract}/${tokenId}` : `${origin}/token/${contract}`)
    : null;

  return {
    chain,
    valid: contractValid,
    explorerName,
    explorerUrl,
  };
}
