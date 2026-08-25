/** PODPLAYR Base Builder Code (base.dev → Settings → Builder Code). */
export const BUILDER_CODE = 'bc_ho2s637x';

/**
 * ERC-8021 attribution suffix for `bc_ho2s637x`.
 * Appended to calldata; contracts ignore it; Base indexers credit the app.
 */
export const BUILDER_CODE_DATA_SUFFIX =
  '0x62635f686f3273363337780b0080218021802180218021802180218021' as const;

const SUFFIX_BODY = BUILDER_CODE_DATA_SUFFIX.slice(2).toLowerCase();

export function calldataHasBuilderCode(data?: string | null): boolean {
  if (!data) return false;
  return data.toLowerCase().replace(/^0x/, '').endsWith(SUFFIX_BODY);
}

/** Append the Builder Code suffix to raw tx calldata. */
export function appendBuilderCode(data?: string | null): `0x${string}` {
  const hex = (data && data !== '0x' ? data : '0x').replace(/^0x/i, '');
  if (hex.toLowerCase().endsWith(SUFFIX_BODY)) {
    return `0x${hex}` as `0x${string}`;
  }
  return `0x${hex}${SUFFIX_BODY}` as `0x${string}`;
}

type SendCallsParams = {
  capabilities?: {
    dataSuffix?: { value: string; optional?: boolean };
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

/** Ensure wallet_sendCalls params include the ERC-8021 dataSuffix capability. */
export function withBuilderCodeCapability<T extends SendCallsParams>(params: T): T {
  return {
    ...params,
    capabilities: {
      ...params.capabilities,
      dataSuffix: params.capabilities?.dataSuffix ?? {
        value: BUILDER_CODE_DATA_SUFFIX,
        optional: true,
      },
    },
  };
}
