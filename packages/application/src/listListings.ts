import type { NormalizedListing } from "@chaoran-property-intelligence/domain";

export interface ListingRecord {
  id: string;
  listing: NormalizedListing;
}

export interface ListingQueryPort {
  listListings(): Promise<ListingRecord[]>;
}

export interface ListListingsOptions {
  query: ListingQueryPort;
}

export class ListListings {
  private readonly query: ListingQueryPort;

  constructor(options: ListListingsOptions) {
    this.query = options.query;
  }

  async execute(): Promise<ListingRecord[]> {
    return this.query.listListings();
  }
}
