const monthlyRequestAllowancePlanningReference = 50;
const fiveMarketWorkerRequestCost = 5;
const sixMarketWorkerRequestCost = 6;

export function formatRentCastAuditQuotaDisclosure(
  requestCount: number,
): readonly string[] {
  return Object.freeze([
    `Requests completed: ${requestCount}`,
    `Audit request cost: ${requestCount}`,
    `Monthly allowance planning reference: ${monthlyRequestAllowancePlanningReference} requests; verify the current account plan and usage before execution.`,
    `Production request cost reference: ${fiveMarketWorkerRequestCost} requests for five incorporated markets; ${sixMarketWorkerRequestCost} requests for all six markets.`,
  ]);
}
