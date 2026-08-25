export const domainPackageName = "@chaoran-property-intelligence/domain";

export {
  isTargetCity,
  matchesListingSearchMarket,
  stevensonRanchListingSearchMarket,
  stevensonRanchListingSearchZipCode,
  type ListingSearchMarketLocation,
} from "./cityFilter.js";
export {
  matchesListingAcquisitionCriteria,
  matchesMvpSearchCriteria,
  matchesNewListingCriteria,
  matchesPriceAlertAcquisitionCriteria,
  type ListingCandidate,
} from "./listingFilter.js";
export {
  defaultListingSearchCriteria,
  InvalidListingSearchCriteriaError,
  isListingPropertyType,
  isListingSearchCity,
  listingPropertyTypes,
  listingSearchCities,
  listingSearchCriteriaSchemaVersion,
  listingSearchState,
  listingSearchStatus,
  maximumListingSearchBathrooms,
  maximumListingSearchBedrooms,
  maximumListingSearchPrice,
  normalizeListingSearchCriteria,
  type ListingPropertyType,
  type ListingSearchCity,
  type ListingSearchCriteriaField,
  type ListingSearchCriteriaV1,
} from "./listingSearchCriteria.js";
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
