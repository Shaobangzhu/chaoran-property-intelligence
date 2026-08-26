const monthlyRequestAllowancePlanningReference = 50;
const fiveMarketWorkerRequestCost = 5;
const sixMarketWorkerRequestCost = 6;
const plannedSevenMarketWorkerRequestCost = 7;

export function formatRentCastAuditQuotaDisclosure(
  requestCount: number,
): readonly string[] {
  return Object.freeze([
    `Requests completed: ${requestCount}`,
    `Audit request cost: ${requestCount}`,
    `Monthly allowance planning reference: ${monthlyRequestAllowancePlanningReference} requests; verify the current account plan and usage before execution.`,
    `Production request cost reference: ${fiveMarketWorkerRequestCost} requests for five incorporated markets; ${sixMarketWorkerRequestCost} requests for all six markets.`,
    `Planned Block 27 request cost reference: ${plannedSevenMarketWorkerRequestCost} requests for all seven markets after Irvine production enablement.`,
  ]);
}
