/**
 * Stellar address validation.
 *
 * Deliberately kept free of module-level side effects — no env validation, no RPC
 * client — so any component or hook can import it without dragging in the network
 * layer. `@/lib/stellar` re-exports these for existing callers.
 */
import { StrKey } from "@stellar/stellar-sdk"

/** True for a checksum-valid contract address (C…). */
export function isValidStellarContractAddress(address: string): boolean {
  return StrKey.isValidContract(address.trim())
}

/** True for a checksum-valid account public key (G…). */
export function isValidStellarPublicKey(address: string): boolean {
  return StrKey.isValidEd25519PublicKey(address.trim())
}

/**
 * True for a checksum-valid Stellar account (G…) or contract (C…) address.
 * Verifies the StrKey checksum, so a 56-character string with the right prefix
 * but a typo in the body is rejected.
 */
export function isValidStellarAddress(address: string): boolean {
  const trimmed = address.trim()
  return StrKey.isValidEd25519PublicKey(trimmed) || StrKey.isValidContract(trimmed)
}
