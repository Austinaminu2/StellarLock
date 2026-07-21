import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { rpc as SorobanRpc } from "@stellar/stellar-sdk"
import { invalidateRpcCache, simulateCall } from "@/lib/stellar"

// Real success responses have several fields; the RpcClient (and the
// isSimulationError() check it relies on) only cares that "error" is absent.
const SUCCESS_RESULT = {} as SorobanRpc.Api.SimulateTransactionResponse

const CONTRACT_ID = "CBFCKEOQRQIXKLGU4QBUQVOINOKFBOXJ37LXEKLKNUO6TW4FNGDU26AW"

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolveFn: ((value: T) => void) | undefined
  const promise = new Promise<T>((res) => {
    resolveFn = res
  })
  return { promise, resolve: (value: T) => resolveFn?.(value) }
}

function spyOnSimulateTransaction() {
  return vi.spyOn(SorobanRpc.Server.prototype, "simulateTransaction")
}

describe("RpcClient (exercised via simulateCall) — caching, dedup, rate limiting", () => {
  let simulateSpy: ReturnType<typeof spyOnSimulateTransaction>

  beforeEach(() => {
    // Frozen clock so cache-TTL boundaries can be advanced precisely.
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"))
    invalidateRpcCache()
    simulateSpy = spyOnSimulateTransaction()
  })

  afterEach(() => {
    simulateSpy.mockRestore()
    vi.useRealTimers()
  })

  it("dedupes identical concurrent calls into a single underlying RPC request", async () => {
    const gate = deferred<SorobanRpc.Api.SimulateTransactionResponse>()
    simulateSpy.mockReturnValue(gate.promise)

    const call1 = simulateCall(CONTRACT_ID, "get_lock", [])
    const call2 = simulateCall(CONTRACT_ID, "get_lock", [])
    await vi.advanceTimersByTimeAsync(0)

    // Both calls should share the one in-flight request, not fire two.
    expect(simulateSpy).toHaveBeenCalledTimes(1)

    gate.resolve(SUCCESS_RESULT)
    await Promise.all([call1, call2])

    expect(simulateSpy).toHaveBeenCalledTimes(1)
  })

  it("does not dedupe distinct calls", async () => {
    simulateSpy.mockResolvedValue(SUCCESS_RESULT)

    await Promise.all([simulateCall(CONTRACT_ID, "get_lock", []), simulateCall(CONTRACT_ID, "get_other_lock", [])])

    expect(simulateSpy).toHaveBeenCalledTimes(2)
  })

  it("serves cached responses within the TTL without a second network call", async () => {
    simulateSpy.mockResolvedValue(SUCCESS_RESULT)

    await simulateCall(CONTRACT_ID, "get_lock", [])
    expect(simulateSpy).toHaveBeenCalledTimes(1)

    // Still within the 10s cache TTL - should be a cache hit.
    await vi.advanceTimersByTimeAsync(9_000)
    await simulateCall(CONTRACT_ID, "get_lock", [])
    expect(simulateSpy).toHaveBeenCalledTimes(1)

    // Past the TTL - should re-fetch.
    await vi.advanceTimersByTimeAsync(2_000)
    await simulateCall(CONTRACT_ID, "get_lock", [])
    expect(simulateSpy).toHaveBeenCalledTimes(2)
  })

  it("invalidateRpcCache() forces a fresh network call even within the TTL", async () => {
    simulateSpy.mockResolvedValue(SUCCESS_RESULT)

    await simulateCall(CONTRACT_ID, "get_lock", [])
    expect(simulateSpy).toHaveBeenCalledTimes(1)

    invalidateRpcCache()

    await simulateCall(CONTRACT_ID, "get_lock", [])
    expect(simulateSpy).toHaveBeenCalledTimes(2)
  })

  it("caps concurrent in-flight requests at 5 and queues the rest", async () => {
    const gates = Array.from({ length: 6 }, () => deferred<SorobanRpc.Api.SimulateTransactionResponse>())
    let callIndex = 0
    simulateSpy.mockImplementation(() => gates[callIndex++].promise)

    // Distinct methods so none of these share a cache/dedup key.
    const calls = gates.map((_, i) => simulateCall(CONTRACT_ID, `method_${i}`, []))
    await vi.advanceTimersByTimeAsync(0)

    // Only MAX_CONCURRENT (5) should have reached the network; the 6th queues.
    expect(simulateSpy).toHaveBeenCalledTimes(5)

    // Draining one in-flight request frees a slot for the queued 6th call.
    gates[0].resolve(SUCCESS_RESULT)
    await vi.advanceTimersByTimeAsync(0)
    expect(simulateSpy).toHaveBeenCalledTimes(6)

    gates.slice(1).forEach((g) => g.resolve(SUCCESS_RESULT))
    await Promise.all(calls)
  })
})
