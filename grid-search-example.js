#!/usr/bin/env node

/**
 * Grid search pattern for complete area coverage
 * Example: Search a postal code area with multiple API calls
 */

async function fetchStoresWithGridSearch(centerLat, centerLng, gridSize = 3) {
  const GRID_SPACING = 0.01; // ~1km spacing
  const allStores = new Map();

  console.log(`Starting grid search: ${gridSize}x${gridSize} pattern`);

  // Create grid of search points
  for (let i = 0; i < gridSize; i++) {
    for (let j = 0; j < gridSize; j++) {
      const offsetLat = (i - Math.floor(gridSize / 2)) * GRID_SPACING;
      const offsetLng = (j - Math.floor(gridSize / 2)) * GRID_SPACING;

      const searchLat = centerLat + offsetLat;
      const searchLng = centerLng + offsetLng;

      console.log(`  Searching point (${i},${j}): ${searchLat.toFixed(4)}, ${searchLng.toFixed(4)}`);

      try {
        // Fetch stores from this grid point
        const stores = await fetchStoresFromAPI(searchLat, searchLng);

        // Deduplicate by map_store_id
        stores.forEach(store => {
          allStores.set(store.map_store_id, store);
        });

        console.log(`    Found ${stores.length} stores (${allStores.size} unique total)`);

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        console.error(`    Error at grid point (${i},${j}):`, error.message);
      }
    }
  }

  console.log(`\nGrid search complete: ${allStores.size} unique stores found`);
  return Array.from(allStores.values());
}

/**
 * Example usage:
 *
 * // 3x3 grid = 9 API calls
 * const stores = await fetchStoresWithGridSearch(35.8177, 139.6797, 3);
 *
 * // Then filter by postal code
 * const filtered = stores.filter(s => s.postal_code === '335-0016');
 */

module.exports = { fetchStoresWithGridSearch };
