export const domainPackageName = "@chaoran-property-intelligence/domain";

export { isTargetCity } from "./cityFilter.js";
export {
  matchesMvpSearchCriteria,
  matchesPriceAlertAcquisitionCriteria,
  type ListingCandidate,
} from "./listingFilter.js";
export type {
  ListingSource,
  ManualNormalizedListing,
  NormalizedListing,
  RentCastNormalizedListing,
} from "./normalizedListing.js";
export {
  createListingAddressKey,
  InvalidListingAddressError,
  isListingAddressKey,
  parseListingAddressKey,
  type ListingAddressInput,
  type ListingAddressKey,
} from "./listingAddress.js";
export {
  PasswordPolicyError,
  normalizePassword,
  validateNewPassword,
  type NormalizedPassword,
  type PasswordContext,
  type PasswordPolicyErrorReason,
} from "./password.js";
export {
  InvalidUserEmailError,
  isUserRole,
  isUserStatus,
  normalizeUserEmail,
  type NormalizedUserEmail,
  type UserAccount,
  type UserRole,
  type UserStatus,
} from "./user.js";
export {
  InvalidManualListingError,
  normalizeManualListingDraft,
  type ManualListingDraftInput,
  type ManualListingInputField,
  type NormalizedManualListingDraft,
} from "./manualListing.js";
