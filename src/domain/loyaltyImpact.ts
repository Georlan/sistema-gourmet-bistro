/** Local scenario: full redemption, contribution before fixed costs; never net profit. */
export function projectLoyaltyImpact(ticket: number, rewardPercent: number, marginPercent: number | null) {
  if (!Number.isFinite(ticket) || ticket <= 0 || !Number.isFinite(rewardPercent) || rewardPercent < 0) return null;
  const benefit = ticket * rewardPercent / 100;
  const validMargin = marginPercent !== null && Number.isFinite(marginPercent) && marginPercent >= 0 && marginPercent <= 100;
  const contributionBefore = validMargin ? ticket * marginPercent / 100 : null;
  return {
    benefit,
    contributionBefore,
    contributionAfter: contributionBefore === null ? null : contributionBefore - benefit,
    exceedsContribution: contributionBefore !== null && benefit > contributionBefore,
  };
}
