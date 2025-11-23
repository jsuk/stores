#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const { Command } = require('commander');
const fetch = require('node-fetch');
const AdmZip = require('adm-zip');
const iconv = require('iconv-lite');

// Configuration
const API_BASE_URL = 'http://localhost:8080/mmeu/api/v3';
const CLIENT_ID = 'integrated';
const CACHE_DIR = path.join(__dirname, '.cache');
const CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

// Store exclusion list (same as in stores.html)
const EXCLUDE_STORE_NAMES_CONTAINING = [
  'セブンイレブン', 'ローソン', 'ファミリーマート', 'ミニストップ', 'デイリーヤマザキ',
  'マクドナルド', 'ケンタッキー', 'モスバーガー', 'すき家', '吉野家', 'なか卯',
  'スターバックス', 'ドトール', 'タリーズ', 'コメダ珈琲',
  // ... (shortened for brevity, add full list as needed)
];

/**
 * Ensure cache directory exists
 */
async function ensureCacheDir() {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
}

/**
 * Check if cache is valid
 */
async function isCacheValid(cachePath) {
  try {
    const stats = await fs.stat(cachePath);
    const age = Date.now() - stats.mtimeMs;
    return age < CACHE_EXPIRY_MS;
  } catch (error) {
    return false;
  }
}

/**
 * Fetch all stores from API
 */
async function fetchStoresFromAPI(centerLat = 35.6812, centerLng = 139.7671) {
  console.log('Fetching stores from API...');
  const url = `${API_BASE_URL}/stores?client_id=${CLIENT_ID}&longitude=${centerLng}&latitude=${centerLat}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`API request failed: ${response.statusText}`);
    }
    const stores = await response.json();
    console.log(`Fetched ${stores.length} stores from API`);
    return stores;
  } catch (error) {
    console.error('Error fetching stores from API:', error.message);
    throw error;
  }
}

/**
 * Fetch store details including postal code
 */
async function fetchStoreDetails(mapStoreId) {
  const url = `${API_BASE_URL}/store/${mapStoreId}?client_id=${CLIENT_ID}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch (error) {
    console.error(`Error fetching details for store ${mapStoreId}:`, error.message);
    return null;
  }
}

/**
 * Filter out excluded stores
 */
function filterExcludedStores(stores) {
  return stores.filter(store => {
    const name = store.store_name || '';
    return !EXCLUDE_STORE_NAMES_CONTAINING.some(excluded => name.includes(excluded));
  });
}

/**
 * Get all stores with details (cached or from API)
 */
async function getAllStores(options = {}) {
  await ensureCacheDir();
  const cachePath = path.join(CACHE_DIR, 'stores_with_details.json');

  // Check cache first
  if (!options.noCache && await isCacheValid(cachePath)) {
    console.log('Loading stores from cache...');
    const data = await fs.readFile(cachePath, 'utf8');
    const stores = JSON.parse(data);
    console.log(`Loaded ${stores.length} stores from cache`);
    return stores;
  }

  // Fetch from API
  let stores = await fetchStoresFromAPI(options.centerLat, options.centerLng);
  stores = filterExcludedStores(stores);

  // Fetch details for each store (in batches to avoid overwhelming the API)
  console.log('Fetching store details...');
  const batchSize = 10;
  const storesWithDetails = [];

  for (let i = 0; i < stores.length; i += batchSize) {
    const batch = stores.slice(i, i + batchSize);
    const detailPromises = batch.map(store => fetchStoreDetails(store.map_store_id));
    const details = await Promise.all(detailPromises);

    batch.forEach((store, idx) => {
      if (details[idx]) {
        storesWithDetails.push({ ...store, ...details[idx] });
      } else {
        storesWithDetails.push(store);
      }
    });

    console.log(`Progress: ${Math.min(i + batchSize, stores.length)}/${stores.length}`);
  }

  // Save to cache
  await fs.writeFile(cachePath, JSON.stringify(storesWithDetails, null, 2));
  console.log(`Cached ${storesWithDetails.length} stores`);

  return storesWithDetails;
}

/**
 * Load and parse postal code data from ZIP file
 */
async function loadPostalData() {
  const zipPath = path.join(__dirname, 'zipcode', 'dl', 'roman', 'KEN_ALL_ROME.zip');

  try {
    const zip = new AdmZip(zipPath);
    const zipEntries = zip.getEntries();

    if (zipEntries.length === 0) {
      throw new Error('No files found in ZIP archive');
    }

    const csvEntry = zipEntries[0];
    const buffer = csvEntry.getData();
    const csvText = iconv.decode(buffer, 'shift_jis');
    const lines = csvText.split('\n');

    const postalData = {};

    for (const line of lines) {
      if (!line.trim()) continue;

      const parts = line.split(',').map(p => p.trim().replace(/^"|"$/g, ''));
      if (parts.length >= 7) {
        const [postalCode, prefecture, city, address, prefecture_rome, city_rome, address_rome] = parts;

        if (!postalData[postalCode]) {
          postalData[postalCode] = [];
        }

        postalData[postalCode].push({
          postalCode,
          prefecture,
          city,
          address,
          prefecture_rome,
          city_rome,
          address_rome
        });
      }
    }

    console.log(`Loaded postal data for ${Object.keys(postalData).length} postal codes`);
    return postalData;
  } catch (error) {
    console.error('Error loading postal data:', error.message);
    return {};
  }
}

/**
 * Filter stores by postal code
 */
function filterStoresByPostalCode(stores, postalCode) {
  // Normalize postal code (remove hyphens)
  const normalized = postalCode.replace(/-/g, '');

  return stores.filter(store => {
    if (!store.postal_code) return false;
    const storePostal = store.postal_code.replace(/-/g, '');
    return storePostal === normalized;
  });
}

/**
 * Calculate distance between two points using Haversine formula
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Order stores using nearest neighbor algorithm (simple TSP approximation)
 */
function orderStoresNearestNeighbor(stores, startLat, startLng) {
  if (stores.length === 0) return [];
  if (stores.length === 1) return stores;

  const ordered = [];
  const remaining = [...stores];
  let currentLat = startLat || stores[0].latitude;
  let currentLng = startLng || stores[0].longitude;

  // If no start point given, use first store
  if (!startLat || !startLng) {
    ordered.push(remaining.shift());
    currentLat = ordered[0].latitude;
    currentLng = ordered[0].longitude;
  }

  while (remaining.length > 0) {
    let nearestIdx = 0;
    let nearestDist = Infinity;

    remaining.forEach((store, idx) => {
      const dist = calculateDistance(currentLat, currentLng, store.latitude, store.longitude);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestIdx = idx;
      }
    });

    const nearest = remaining.splice(nearestIdx, 1)[0];
    ordered.push(nearest);
    currentLat = nearest.latitude;
    currentLng = nearest.longitude;
  }

  return ordered;
}

/**
 * Generate KML file from ordered stores
 */
function generateKML(orderedStores, postalCode, postalInfo) {
  const escapeTags = (str) => {
    if (!str) return '';
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&apos;');
  };

  let kml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  kml += '<kml xmlns="http://www.opengis.net/kml/2.2">\n';
  kml += '<Document>\n';
  kml += `  <name>Rpay Stores Route - ${escapeTags(postalCode)}</name>\n`;

  if (postalInfo && postalInfo.length > 0) {
    const info = postalInfo[0];
    kml += `  <description>Route for postal code ${escapeTags(postalCode)} (${escapeTags(info.prefecture)} ${escapeTags(info.city)} ${escapeTags(info.address)})</description>\n`;
  } else {
    kml += `  <description>Route for postal code ${escapeTags(postalCode)}</description>\n`;
  }

  // Define styles
  kml += '  <Style id="startPoint">\n';
  kml += '    <IconStyle>\n';
  kml += '      <color>ff0000ff</color>\n'; // Red
  kml += '      <scale>1.2</scale>\n';
  kml += '      <Icon>\n';
  kml += '        <href>http://maps.google.com/mapfiles/kml/paddle/red-circle.png</href>\n';
  kml += '      </Icon>\n';
  kml += '    </IconStyle>\n';
  kml += '  </Style>\n';

  kml += '  <Style id="storePoint">\n';
  kml += '    <IconStyle>\n';
  kml += '      <color>ff00ff00</color>\n'; // Green
  kml += '      <Icon>\n';
  kml += '        <href>http://maps.google.com/mapfiles/kml/paddle/grn-blank.png</href>\n';
  kml += '      </Icon>\n';
  kml += '    </IconStyle>\n';
  kml += '  </Style>\n';

  kml += '  <Style id="routeLine">\n';
  kml += '    <LineStyle>\n';
  kml += '      <color>ff0000ff</color>\n'; // Blue
  kml += '      <width>3</width>\n';
  kml += '    </LineStyle>\n';
  kml += '  </Style>\n';

  // Add placemarks for each store
  orderedStores.forEach((store, index) => {
    const isFirst = index === 0;
    const styleId = isFirst ? 'startPoint' : 'storePoint';

    kml += '  <Placemark>\n';
    kml += `    <name>${index + 1}. ${escapeTags(store.store_name)}</name>\n`;
    kml += '    <description>';
    kml += `Store ID: ${escapeTags(store.map_store_id)}\\n`;
    if (store.postal_code) {
      kml += `Postal Code: ${escapeTags(store.postal_code)}\\n`;
    }
    kml += `Position: ${index + 1} of ${orderedStores.length}`;
    kml += '</description>\n';
    kml += `    <styleUrl>#${styleId}</styleUrl>\n`;
    kml += '    <Point>\n';
    kml += `      <coordinates>${store.longitude},${store.latitude},0</coordinates>\n`;
    kml += '    </Point>\n';
    kml += '  </Placemark>\n';
  });

  // Add route line
  if (orderedStores.length > 1) {
    kml += '  <Placemark>\n';
    kml += '    <name>Route</name>\n';
    kml += '    <description>Optimized route through all stores</description>\n';
    kml += '    <styleUrl>#routeLine</styleUrl>\n';
    kml += '    <LineString>\n';
    kml += '      <tessellate>1</tessellate>\n';
    kml += '      <coordinates>\n';

    orderedStores.forEach(store => {
      kml += `        ${store.longitude},${store.latitude},0\n`;
    });

    kml += '      </coordinates>\n';
    kml += '    </LineString>\n';
    kml += '  </Placemark>\n';
  }

  kml += '</Document>\n';
  kml += '</kml>\n';

  return kml;
}

/**
 * Main CLI function
 */
async function main() {
  const program = new Command();

  program
    .name('kml-generator')
    .description('Generate KML files for rpay stores based on Japanese postal codes')
    .version('1.0.0')
    .argument('<postal-code>', 'Japanese postal code (e.g., 100-0001 or 1000001)')
    .option('-o, --output <file>', 'Output KML file path')
    .option('--no-cache', 'Skip cache and fetch fresh data from API')
    .option('--center-lat <latitude>', 'Center latitude for store search', parseFloat)
    .option('--center-lng <longitude>', 'Center longitude for store search', parseFloat)
    .option('--no-optimize', 'Skip route optimization (use store order as-is)')
    .action(async (postalCode, options) => {
      try {
        console.log(`\n🗾 Rpay Store KML Generator`);
        console.log(`=====================================\n`);

        // Normalize postal code
        const normalizedPostalCode = postalCode.replace(/-/g, '');

        // Load postal data
        console.log('📍 Loading postal code data...');
        const postalData = await loadPostalData();
        const postalInfo = postalData[normalizedPostalCode];

        if (postalInfo && postalInfo.length > 0) {
          const info = postalInfo[0];
          console.log(`   Postal Code: ${normalizedPostalCode}`);
          console.log(`   Address: ${info.prefecture} ${info.city} ${info.address}`);
        } else {
          console.log(`   Warning: Postal code ${normalizedPostalCode} not found in database`);
        }

        // Get all stores
        console.log('\n🏪 Fetching store data...');
        const allStores = await getAllStores({
          noCache: !options.cache,
          centerLat: options.centerLat,
          centerLng: options.centerLng
        });

        // Filter by postal code
        console.log(`\n🔍 Filtering stores by postal code ${normalizedPostalCode}...`);
        let filteredStores = filterStoresByPostalCode(allStores, normalizedPostalCode);
        console.log(`   Found ${filteredStores.length} stores`);

        if (filteredStores.length === 0) {
          console.log('\n❌ No stores found for this postal code');
          process.exit(1);
        }

        // Order stores
        let orderedStores;
        if (options.optimize !== false) {
          console.log('\n🚀 Optimizing route using nearest neighbor algorithm...');
          orderedStores = orderStoresNearestNeighbor(filteredStores);
          console.log(`   Ordered ${orderedStores.length} stores`);
        } else {
          orderedStores = filteredStores;
        }

        // Generate KML
        console.log('\n📄 Generating KML file...');
        const kml = generateKML(orderedStores, normalizedPostalCode, postalInfo);

        // Determine output path
        const outputPath = options.output || `route_${normalizedPostalCode}.kml`;
        await fs.writeFile(outputPath, kml, 'utf8');

        console.log(`\n✅ KML file generated successfully!`);
        console.log(`   File: ${path.resolve(outputPath)}`);
        console.log(`   Stores: ${orderedStores.length}`);
        console.log(`\n📋 Store list:`);
        orderedStores.forEach((store, idx) => {
          console.log(`   ${idx + 1}. ${store.store_name}`);
        });

        console.log(`\n💡 Import this KML file into Google Maps to view the route.\n`);

      } catch (error) {
        console.error('\n❌ Error:', error.message);
        if (process.env.DEBUG) {
          console.error(error.stack);
        }
        process.exit(1);
      }
    });

  program.parse();
}

// Run the CLI
if (require.main === module) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = {
  getAllStores,
  filterStoresByPostalCode,
  orderStoresNearestNeighbor,
  generateKML,
  loadPostalData
};
