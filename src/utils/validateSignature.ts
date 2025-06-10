import { createPublicClient, http, toHex } from 'viem';
import { mainnet } from 'viem/chains';

const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(),
});

export async function validateSignature(
  header: string,
  payload: string,
  signature: string
): Promise<boolean> {
  try {
    const decodedHeader = JSON.parse(Buffer.from(header, 'base64url').toString());
    const message = `${header}.${payload}`;
    const messageBytes = Buffer.from(message);
    const signatureBytes = Buffer.from(signature, 'base64url');

    // Convert Buffer to hex string with 0x prefix for viem compatibility
    const messageHex = toHex(messageBytes);
    const signatureHex = toHex(signatureBytes);

    // Verify the signature using viem
    const valid = await publicClient.verifyMessage({
      address: decodedHeader.signer as `0x${string}`,
      message: messageHex,
      signature: signatureHex,
    });

    return valid;
  } catch (error) {
    console.error('Error validating signature:', error);
    return false;
  }
}
