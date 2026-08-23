import { describe, it, expect } from "vitest"
import { isValidStellarAddress, isValidStellarContractAddress, isValidStellarPublicKey } from "@/lib/stellar-address"

// Real checksum-valid addresses.
const VALID_ACCOUNT = "GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR"
const VALID_CONTRACT = "CBFCKEOQRQIXKLGU4QBUQVOINOKFBOXJ37LXEKLKNUO6TW4FNGDU26AW"

// 56 characters with a valid G/C prefix but a corrupted body — the exact shape the
// old length-and-prefix check let through.
const BAD_CHECKSUM_ACCOUNT = "GABC1234GABC1234GABC1234GABC1234GABC1234GABC1234GABC1234"
const BAD_CHECKSUM_CONTRACT = "CABC1234CABC1234CABC1234CABC1234CABC1234CABC1234CABC1234"

describe("isValidStellarAddress", () => {
  it("accepts a checksum-valid account address", () => {
    expect(isValidStellarAddress(VALID_ACCOUNT)).toBe(true)
  })

  it("accepts a checksum-valid contract address", () => {
    expect(isValidStellarAddress(VALID_CONTRACT)).toBe(true)
  })

  it("rejects a 56-character G address with an invalid checksum", () => {
    expect(BAD_CHECKSUM_ACCOUNT).toHaveLength(56)
    expect(isValidStellarAddress(BAD_CHECKSUM_ACCOUNT)).toBe(false)
  })

  it("rejects a 56-character C address with an invalid checksum", () => {
    expect(BAD_CHECKSUM_CONTRACT).toHaveLength(56)
    expect(isValidStellarAddress(BAD_CHECKSUM_CONTRACT)).toBe(false)
  })

  it("rejects a single flipped character in an otherwise valid address", () => {
    const flipped = VALID_ACCOUNT.slice(0, 10) + "X" + VALID_ACCOUNT.slice(11)
    expect(flipped).toHaveLength(56)
    expect(isValidStellarAddress(flipped)).toBe(false)
  })

  it("rejects empty and malformed input", () => {
    expect(isValidStellarAddress("")).toBe(false)
    expect(isValidStellarAddress("not-an-address")).toBe(false)
  })

  it("tolerates surrounding whitespace", () => {
    expect(isValidStellarAddress(`  ${VALID_ACCOUNT}  `)).toBe(true)
  })
})

describe("prefix-specific validators", () => {
  it("isValidStellarPublicKey only accepts accounts", () => {
    expect(isValidStellarPublicKey(VALID_ACCOUNT)).toBe(true)
    expect(isValidStellarPublicKey(VALID_CONTRACT)).toBe(false)
    expect(isValidStellarPublicKey(BAD_CHECKSUM_ACCOUNT)).toBe(false)
  })

  it("isValidStellarContractAddress only accepts contracts", () => {
    expect(isValidStellarContractAddress(VALID_CONTRACT)).toBe(true)
    expect(isValidStellarContractAddress(VALID_ACCOUNT)).toBe(false)
    expect(isValidStellarContractAddress(BAD_CHECKSUM_CONTRACT)).toBe(false)
  })
})
