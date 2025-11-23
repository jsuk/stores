#!/usr/bin/env node

/**
 * Hexagonal grid search pattern for optimal area coverage
 * Hexagons provide better coverage than square grids with fewer API calls
 */

/**
 * Generate hexagonal grid coordinates
 * @param {number} centerLat - Center latitude
 * @param {number} centerLng - Center longitude
 * @param {number} rings - Number of hexagon rings (1 = center + 6 neighbors, 2 = center + 18, etc.)
 * @param {number} spacing - Distance between hexagon centers in degrees (~0.01 = 1km)
 * @returns {Array} Array of {lat, lng} coordinates
 */
function generateHexagonalGrid(centerLat, centerLng, rings = 2, spacing = 0.01) {
  const points = [];

  // Add center point
  points.push({ lat: centerLat, lng: centerLng });

  // Hexagonal grid: each hex has 6 neighbors at 60° intervals
  // Using axial coordinates (q, r) system

  for (let ring = 1; ring <= rings; ring++) {
    // Start at "east" position
    let q = ring;
    let r = 0;

    // Walk around the hexagon ring
    for (let side = 0; side < 6; side++) {
      for (let step = 0; step < ring; step++) {
        // Convert axial coordinates to lat/lng
        const lat = centerLat + (q * spacing);
        const lng = centerLng + ((r + q / 2) * spacing * Math.cos(centerLat * Math.PI / 180));

        points.push({ lat, lng });

        // Move to next hex in this ring
        // Hexagon directions: E, NE, NW, W, SW, SE
        const directions = [
          { q: 0, r: -1 },  // NE
          { q: -1, r: 0 },  // NW
          { q: -1, r: 1 },  // W
          { q: 0, r: 1 },   // SW
          { q: 1, r: 0 },   // SE
          { q: 1, r: -1 }   // E
        ];

        q += directions[side].q;
        r += directions[side].r;
      }
    }
  }

  return points;
}

/**
 * Calculate number of hexagons for given rings
 * @param {number} rings - Number of rings
 * @returns {number} Total hexagons (including center)
 */
function hexagonCount(rings) {
  if (rings === 0) return 1;
  return 1 + (3 * rings * (rings + 1));
}

/**
 * Fetch stores using hexagonal grid pattern
 * @param {Function} fetchStoresFromAPI - Function to fetch stores from API
 * @param {number} centerLat - Center latitude
 * @param {number} centerLng - Center longitude
 * @param {number} rings - Number of hexagon rings
 * @param {number} spacing - Spacing between hexagons (degrees)
 * @returns {Promise<Array>} Array of unique stores
 */
async function fetchStoresWithHexagonalGrid(fetchStoresFromAPI, centerLat, centerLng, rings = 2, spacing = 0.01) {
  const gridPoints = generateHexagonalGrid(centerLat, centerLng, rings, spacing);
  const allStores = new Map();
  const totalPoints = gridPoints.length;

  console.log(`\n🔷 Hexagonal Grid Search`);
  console.log(`   Center: ${centerLat.toFixed(4)}, ${centerLng.toFixed(4)}`);
  console.log(`   Rings: ${rings}`);
  console.log(`   Spacing: ${spacing}° (~${(spacing * 111).toFixed(1)}km)`);
  console.log(`   Grid points: ${totalPoints}`);
  console.log(`   Coverage area: ~${(totalPoints * Math.PI * Math.pow(spacing * 111, 2)).toFixed(1)} km²\n`);

  let processedCount = 0;

  for (const point of gridPoints) {
    processedCount++;
    console.log(`  [${processedCount}/${totalPoints}] Searching: ${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`);

    try {
      const stores = await fetchStoresFromAPI(point.lat, point.lng);

      // Deduplicate by map_store_id
      let newStores = 0;
      stores.forEach(store => {
        if (!allStores.has(store.map_store_id)) {
          allStores.set(store.map_store_id, store);
          newStores++;
        }
      });

      console.log(`    Found ${stores.length} stores (${newStores} new, ${allStores.size} total unique)`);

      // Rate limiting: 500ms between requests
      if (processedCount < totalPoints) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }

    } catch (error) {
      console.error(`    ❌ Error:`, error.message);
    }
  }

  console.log(`\n✅ Hexagonal grid search complete!`);
  console.log(`   Total unique stores: ${allStores.size}`);
  console.log(`   API calls made: ${totalPoints}`);
  console.log(`   Coverage efficiency: ${(allStores.size / totalPoints).toFixed(2)} stores/call\n`);

  return Array.from(allStores.values());
}

/**
 * Example usage and comparison
 */
function exampleUsage() {
  console.log('🔷 Hexagonal Grid Coverage Examples\n');

  console.log('Grid Size Comparison:');
  console.log('┌───────┬──────────┬─────────────┬───────────────┐');
  console.log('│ Rings │ Hexagons │ Square Grid │ API Savings   │');
  console.log('├───────┼──────────┼─────────────┼───────────────┤');
  console.log('│   1   │     7    │      9      │ 22% fewer     │');
  console.log('│   2   │    19    │     25      │ 24% fewer     │');
  console.log('│   3   │    37    │     49      │ 24% fewer     │');
  console.log('│   4   │    61    │     81      │ 25% fewer     │');
  console.log('└───────┴──────────┴─────────────┴───────────────┘\n');

  console.log('Recommended configurations:\n');
  console.log('Small postal code (1-2 km²):');
  console.log('  rings=1, spacing=0.008 → 7 API calls, ~5 km² coverage\n');

  console.log('Medium postal code (3-5 km²):');
  console.log('  rings=2, spacing=0.01 → 19 API calls, ~12 km² coverage\n');

  console.log('Large postal code (5-10 km²):');
  console.log('  rings=3, spacing=0.01 → 37 API calls, ~23 km² coverage\n');
}

// Example implementation
async function example() {
  // Mock API function (replace with real implementation)
  async function mockFetchStoresFromAPI(lat, lng) {
    // Simulate API call
    return [
      { map_store_id: `store_${lat}_${lng}`, store_name: 'Example Store', latitude: lat, longitude: lng }
    ];
  }

  // Toda City, Saitama (postal 335-0016)
  const centerLat = 35.8177;
  const centerLng = 139.6797;

  // Use 2 rings for medium coverage
  const stores = await fetchStoresWithHexagonalGrid(
    mockFetchStoresFromAPI,
    centerLat,
    centerLng,
    2,      // rings
    0.01    // spacing (~1km)
  );

  console.log(`\nResult: ${stores.length} unique stores found`);
}

module.exports = {
  generateHexagonalGrid,
  fetchStoresWithHexagonalGrid,
  hexagonCount,
  exampleUsage
};

// Run example if executed directly
if (require.main === module) {
  exampleUsage();
}
