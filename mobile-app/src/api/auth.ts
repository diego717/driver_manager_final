import CryptoJS from "crypto-js";

export function sha256HexFromString(input: string): string {
  return CryptoJS.SHA256(input).toString(CryptoJS.enc.Hex);
}

export function sha256HexFromBytes(bytes: Uint8Array): string {
  const wordArray = CryptoJS.lib.WordArray.create(bytes as unknown as number[]);
  return CryptoJS.SHA256(wordArray).toString(CryptoJS.enc.Hex);
}
