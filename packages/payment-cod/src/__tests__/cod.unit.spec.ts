import CodProviderService from "../service"

describe("cod", () => {
  const p = new (CodProviderService as any)({}, { max_amount: 1000000 })

  it("updatePayment keeps session data and updates the amount (F-001)", async () => {
    const init = await p.initiatePayment({ amount: 250000, currency_code: "vnd", data: { session_id: "payses_1" } })
    const out = await p.updatePayment({ amount: 300000, currency_code: "vnd", data: init.data })
    expect(out).toEqual({ data: { ...init.data, cod: { amount: 300000 } } })
  })

  it("rejects amounts above max_amount on update", async () => {
    await expect(p.updatePayment({ amount: 2000000, currency_code: "vnd", data: {} })).rejects.toThrow(/above/)
  })
})
