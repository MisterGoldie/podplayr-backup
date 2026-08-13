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

export function toDecimalTokenId(tokenId?: string | number | null): string {
  if (tokenId === undefined || tokenId === null || tokenId === '') return '';
  const raw = String(tokenId).trim();
  if (/^\d+$/.test(raw)) return raw;

  const hex = raw.startsWith('0x') || raw.startsWith('0X') ? raw : (/[a-f]/i.test(raw) ? `0x${raw}` : raw);
  if (hex.startsWith('0x') || hex.startsWith('0X')) {
    try {
      return BigInt(hex).toString(10);
    } catch {
      return raw.replace(/^0x/i, '');
    }
  }
  return raw;
}

export function normalizeContractAddress(contract?: string | null): string {
  if (!contract) return '';
  const trimmed = contract.trim();
  const withPrefix = trimmed.startsWith('0x') || trimmed.startsWith('0X') ? trimmed : `0x${trimmed}`;
  return withPrefix.toLowerCase();
}

/**
 * Explorer link for the info panel.
 * Unknown chain defaults to Base so we never show Etherscan for an untagged Base NFT.
 * No marketplace buttons — OpenSea/Zora 404 when the mint isn't indexed there.
 */
export function getNftExplorerLinks(nft: NFT) {
  const chain = normalizeNftChain(nft.network) ?? 'base';
  const contract = normalizeContractAddress(nft.contract);
  const tokenId = toDecimalTokenId(nft.tokenId);
  const valid = Boolean(contract && /^0x[a-f0-9]{40}$/.test(contract) && tokenId);

  const explorerName = chain === 'base' ? 'Basescan' : 'Etherscan';
  const explorerUrl = valid
    ? (chain === 'base'
      ? `https://basescan.org/nft/${contract}/${tokenId}`
      : `https://etherscan.io/nft/${contract}/${tokenId}`)
    : null;

  return {
    chain,
    valid,
    explorerName,
    explorerUrl,
  };
}
