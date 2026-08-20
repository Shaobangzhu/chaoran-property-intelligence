import { ListingsScreen, type ListingsLoader } from "./ListingsScreen.js";
import { fetchListings } from "./listingsApi.js";

const loadListings: ListingsLoader = (signal) => fetchListings({ signal });

export function App(): React.JSX.Element {
  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="/" aria-label="Chaoran Property Intelligence">
          <span className="brand-mark" aria-hidden="true">
            CPI
          </span>
          <span className="brand-name">Chaoran Property Intelligence</span>
        </a>
        <span className="snapshot-indicator">Saved property data</span>
      </header>
      <ListingsScreen loadListings={loadListings} />
    </div>
  );
}
