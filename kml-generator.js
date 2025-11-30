#!/usr/bin/env node

const fs = require('fs').promises;
const path = require('path');
const zlib = require('zlib');
const { promisify } = require('util');
const { Command } = require('commander');
const fetch = require('node-fetch');
const AdmZip = require('adm-zip');
const iconv = require('iconv-lite');
const wellknown = require('wellknown');
const gdal = require('gdal-async');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const roundCoordinate = (coord, precision = 7) => {
  return parseFloat(coord.toFixed(precision));
};


// Configuration
const API_BASE_URL = process.env.RAKUTEN_API_URL || 'https://gateway-api.global.rakuten.com/mmeu/api/v3';
const CLIENT_ID = 'integrated';
const CACHE_DIR = path.join(__dirname, '.cache');
const CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Geocode postal code using e-stat.go.jp SPARQL endpoint
 */
async function geocodePostalCode(postalCode, postalInfo) {
  if (!postalInfo || postalInfo.length === 0) {
    console.warn(`No postal info available for ${postalCode}. Cannot geocode.`);
    return null;
  }
  const info = postalInfo[0];
  const { prefecture, city, address } = info;

  console.log(`Geocoding address: ${prefecture} ${city} ${address}`);

  const sparqlEndpoint = 'https://data.e-stat.go.jp/lod/sparql/alldata/query';

  // Step 1: Find entities that have geometry and are part of the city and prefecture,
  // and whose label matches the address part.
  const findGeomEntityQuery = `
    PREFIX geo: <http://www.opengis.net/ont/geosparql#>
    PREFIX dcterms: <http://purl.org/dc/terms/>
    PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

    SELECT DISTINCT ?geom_entity ?label ?geom
    WHERE {
      ?geom_entity geo:hasGeometry/geo:asWKT ?geom .
      ?geom_entity rdfs:label ?label .
      FILTER(LANG(?label) = "ja")
      FILTER(CONTAINS(STR(?label), "${address}")) # Filter by address part

      ?geom_entity dcterms:isPartOf ?city_entity .
      ?city_entity rdfs:label "${city}"@ja .

      ?city_entity dcterms:isPartOf ?pref_entity .
      ?pref_entity rdfs:label "${prefecture}"@ja .
    }
  `;

  try {
    console.log('Executing SPARQL Query:', findGeomEntityQuery);
    const geomResponse = await fetch(sparqlEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/sparql-results+json' },
      body: new URLSearchParams({ query: findGeomEntityQuery })
    });

    if (!geomResponse.ok) {
      throw new Error(`SPARQL query failed: ${geomResponse.statusText}`);
    }

    const geomData = await geomResponse.json();
    console.log("SPARQL Geom Data Bindings:", JSON.stringify(geomData.results.bindings, null, 2));

    if (!geomData.results || !geomData.results.bindings || geomData.results.bindings.length === 0) {
      console.warn(`No geometry found for: ${prefecture} ${city} ${address}`);
      return null;
    }

    // Try to find the most specific match, prioritize exact match on address label
    let bestMatch = geomData.results.bindings.find(binding => {
      return binding.LABEL && binding.LABEL.value.startsWith(address);
    });

    // If no exact match, take the first one (could be broader area like a chome)
    if (!bestMatch) {
        console.warn(`No exact label match for "${address}". Using first available geometry.`);
        bestMatch = geomData.results.bindings[0];
    }
    
    const rawWkt = bestMatch.GEOM.value;
    const wktMatch = rawWkt.match(/(POLYGON|MULTIPOLYGON)\s*\(.*\)/);
    if (!wktMatch) {
        console.warn(`Could not extract WKT from: ${rawWkt}`);
        return null;
    }
    const wkt = wktMatch[0];
    const geojson = wellknown.parse(wkt);

    const [lon, lat] = calculateCentroid(geojson);
    console.log(`Geocoded to Lat: ${lat}, Lng: ${lon}`);
    return { latitude: lat, longitude: lon, geojson: geojson };

  } catch (error) {
    console.error('Error geocoding with SPARQL:', error.message);
    return null;
  }
}

/**
 * Geocode area code using e-stat.go.jp SPARQL endpoint
 * @param {string} areaCode - Japanese area code (5 digits for municipality, 9-12 for smaller areas)
 * @returns {Object|null} Geocoding result with latitude, longitude, and geojson
 */
async function geocodeAreaCode(areaCode) {
  console.log(`Geocoding area code: ${areaCode}`);

  const sparqlEndpoint = 'https://data.e-stat.go.jp/lod/sparql/alldata/query';

  // Normalize the area code (remove any prefixes or formatting)
  const normalized = areaCode.replace(/[^0-9]/g, '');

  // Determine query based on code length
  let query;

  if (normalized.length === 5) {
    // Municipality code (prefecture 2 digits + municipality 3 digits)
    // Query for municipality-level geometry using Standard Area Code System (SACS)
    query = `
      PREFIX geo: <http://www.opengis.net/ont/geosparql#>
      PREFIX ic: <http://imi.go.jp/ns/core/rdf#>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      PREFIX dcterms: <http://purl.org/dc/terms/>
      PREFIX sacs: <http://data.e-stat.go.jp/lod/terms/sacs#>
      PREFIX administrativeArea: <http://data.e-stat.go.jp/lod/ontology/administrativeArea/>
      PREFIX cd-dimension: <http://data.e-stat.go.jp/lod/ontology/crossDomain/dimension/>

      SELECT DISTINCT ?label ?geom
      WHERE {
        {
          # Try Standard Area Code System first
          ?codeValue dcterms:identifier ?id filter(regex(?id,"^${normalized}")) .
	  ?codeValue rdf:type <http://data.e-stat.go.jp/lod/terms/smallArea/SmallAreaCode>.
          ?codeValue rdfs:label ?label .
          ?codeValue geo:hasGeometry/geo:asWKT ?geom .
          FILTER(LANG(?label) = "ja")
        } UNION {
          # Fallback to administrative area query
          ?area a administrativeArea:AdministrativeArea ;
                cd-dimension:standardAreaCode ?code ;
                rdfs:label ?label ;
                geo:hasGeometry/geo:asWKT ?geom .
          FILTER(STR(?code) = "${normalized}")
          FILTER(LANG(?label) = "ja")
        }
      }
    `;
  } else if (normalized.length >= 9 && normalized.length <= 12) {
    // Small area code (9 digits), basic unit area (11 digits), or smaller (12 digits)
    // Query using Standard Area Code System with hierarchical structure
    query = `
      PREFIX geo: <http://www.opengis.net/ont/geosparql#>
      PREFIX ic: <http://imi.go.jp/ns/core/rdf#>
      PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
      PREFIX dcterms: <http://purl.org/dc/terms/>
      PREFIX sacs: <http://data.e-stat.go.jp/lod/terms/sacs#>

      SELECT DISTINCT ?label ?geom
      WHERE {
        {
          # Try to find the area code with hierarchical structure
          ?codeValue <http://purl.org/dc/terms/identifier> ?codeStr .
          FILTER(CONTAINS(?codeStr, "${normalized}"))
          ?plainCode sacs:latestCode ?codeValue .
          ?codeValue rdfs:label ?label .
          ?codeValue geo:hasGeometry/geo:asWKT ?geom .
          FILTER(LANG(?label) = "ja")
          FILTER NOT EXISTS { ?codeValue sacs:succeedingCode ?x }
        } UNION {
          # Fallback: try as a direct identifier
          ?area <http://purl.org/dc/terms/identifier> "${normalized}" .
          ?area rdfs:label ?label .
          ?area geo:hasGeometry/geo:asWKT ?geom .
          FILTER(LANG(?label) = "ja")
        }
      }
    `;
  } else {
    console.error(`Invalid area code length: ${normalized.length}. Expected 5, 9, 11, or 12 digits.`);
    return null;
  }

  try {
    console.log('Executing SPARQL Query:', query);
    const response = await fetch(sparqlEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/sparql-results+json'
      },
      body: new URLSearchParams({ query })
    });

    if (!response.ok) {
      throw new Error(`SPARQL query failed: ${response.statusText}`);
    }

    const data = await response.json();
    console.log("SPARQL Area Code Data Bindings:", JSON.stringify(data.results.bindings, null, 2));

    if (!data.results || !data.results.bindings || data.results.bindings.length === 0) {
      console.warn(`No geometry found for area code: ${areaCode}`);
      return []; // Return empty array
    }

    const results = data.results.bindings.map(binding => {
      // Assuming 'geom' and 'label' are present and lowercase as per typical SPARQL JSON results
      // Checking for existence of binding.geom and binding.label for robustness
      if (!binding.GEOM || !binding.GEOM.value || !binding.LABEL) {
        console.warn(`Skipping binding due to missing geometry or label: ${JSON.stringify(binding)}`);
        return null;
      }

      const rawWkt = binding.GEOM.value;
      const label = binding.LABEL.value;

      const wktMatch = rawWkt.match(/(POINT|POLYGON|MULTIPOLYGON)\s*\(.*\)/);
      if (!wktMatch) {
        console.warn(`Could not extract WKT from: ${rawWkt}`);
        return null;
      }
      const wkt = wktMatch[0];
      const geojson = wellknown.parse(wkt);
      const [lon, lat] = calculateCentroid(geojson);

      return {
        latitude: lat,
        longitude: lon,
        geojson: geojson,
        label: label
      };
    }).filter(Boolean); // Filter out null results from map

    console.log(`Found ${results.length} geometries for area code: ${areaCode}`);
    return results;

  } catch (error) {
    console.error('Error geocoding area code with SPARQL:', error.message);
    return null;
  }
}

/**
 * Calculate centroid of a GeoJSON polygon.
 * This is a simple approximation.
 */
function calculateCentroid(geojson) {
  if (geojson.type === 'Polygon') {
    const coords = geojson.coordinates[0];
    let x = 0;
    let y = 0;
    for (const [lon, lat] of coords) {
      x += lon;
      y += lat;
    }
    return [x / coords.length, y / coords.length];
  } else if (geojson.type === 'MultiPolygon') {
    // For MultiPolygon, find the largest polygon and calculate its centroid
    let largestPolygon = geojson.coordinates[0];
    let maxArea = 0;

    for (const polygon of geojson.coordinates) {
        let area = 0;
        const ring = polygon[0];
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            area += (ring[i][0] * ring[j][1]) - (ring[j][0] * ring[i][1]);
        }
        area = Math.abs(area / 2);

        if (area > maxArea) {
            maxArea = area;
            largestPolygon = polygon;
        }
    }
    const coords = largestPolygon[0];
    let x = 0;
    let y = 0;
    for (const [lon, lat] of coords) {
      x += lon;
      y += lat;
    }
    return [x / coords.length, y / coords.length];
  }
  return [0, 0];
}

/**
 * Generate tessellated hexagon polygons covering a GeoJSON polygon using GDAL
 * @param {Object} geojson - GeoJSON polygon or multipolygon
 * @param {number} resolution - H3 resolution level (7-11), converted to hexagon size
 * @returns {Array} Array of hexagon geometries as GeoJSON polygons
 */
function generateHexagonPolygons(geojson, resolution = 8) {
  try {
    // Map H3 resolution to approximate hexagon edge length in degrees
    const resolutionToSize = {
      7: 0.011,    // ~1.22 km
      8: 0.0041,   // ~0.46 km
      9: 0.0015,   // ~0.17 km
      10: 0.00058, // ~0.065 km
      11: 0.00022  // ~0.025 km
    };

    const hexSize = resolutionToSize[resolution] || resolutionToSize[8];

    // Convert GeoJSON to WKT
    const wkt = wellknown.stringify(geojson);

    // Create GDAL geometry from WKT
    const polygon = gdal.Geometry.fromWKT(wkt);

    // Get the envelope (bounding box) of the polygon
    const envelope = polygon.getEnvelope();
    const { minX, maxX, minY, maxY } = envelope;

    // Calculate hexagon dimensions for flat-top hexagons
    const hexWidth = Math.sqrt(3) * hexSize;
    const hexHeight = 2 * hexSize;

    const hexagons = [];

    // Generate hexagonal grid (flat-top)
    let row = 0;
    for (let y = minY; y <= maxY + hexHeight / 2; y += hexHeight * 0.75, row++) {
      const offsetX = (row % 2) * hexWidth / 2;

      for (let x = minX; x <= maxX + hexWidth / 2; x += hexWidth) {
        const centerX = x + offsetX;
        const centerY = y;

        // Create hexagon geometry
        const hexCoords = [];
        const precision = 7;
        for (let i = 0; i < 6; i++) {
          const angle = Math.PI / 3 * i + Math.PI / 6; // Start at 30 degrees for flat top
          const vx = roundCoordinate(centerX + hexSize * Math.cos(angle), precision);
          const vy = roundCoordinate(centerY + hexSize * Math.sin(angle), precision);
          hexCoords.push([vx, vy]);
        }
        hexCoords.push(hexCoords[0]); // Close the ring

        // Create polygon from coordinates
        const hexRing = new gdal.LinearRing();
        hexCoords.forEach(([hx, hy]) => hexRing.points.add(hx, hy));

        const hexPolygon = new gdal.Polygon();
        hexPolygon.rings.add(hexRing);

        // Check if hexagon intersects with the original polygon
        if (hexPolygon.intersects(polygon)) {
          // Get the intersection to verify it's meaningful (not just touching)
          const intersection = hexPolygon.intersection(polygon);
          if (intersection && intersection.getArea() > 0) {
            // Convert hexagon to GeoJSON
            const hexWkt = hexPolygon.toWKT();
            const hexGeoJSON = wellknown.parse(hexWkt);

            hexagons.push({
              geometry: hexGeoJSON,
              center: { latitude: centerY, longitude: centerX }
            });
          }
        }
      }
    }

    console.log(`Generated ${hexagons.length} hexagon polygons covering the area`);
    return hexagons;

  } catch (error) {
    console.error('Error generating hexagon polygons with GDAL:', error.message);
    return [];
  }
}

/**
 * Generate hexagon centroids from a GeoJSON polygon using GDAL
 * @param {Object} geojson - GeoJSON polygon or multipolygon
 * @param {number} resolution - H3 resolution level (7-11), converted to hexagon size
 * @returns {Array} Array of {latitude, longitude} objects representing hexagon centroids
 */
function generateHexagonCentroids(geojson, resolution = 8) {
  try {
    // Map H3 resolution to approximate hexagon edge length in degrees
    // H3 resolutions and their approximate edge lengths:
    // 7: ~1.22 km, 8: ~0.46 km, 9: ~0.17 km, 10: ~0.065 km, 11: ~0.025 km
    const resolutionToSize = {
      7: 0.011,  // ~1.22 km
      8: 0.0041, // ~0.46 km
      9: 0.0015, // ~0.17 km
      10: 0.00058, // ~0.065 km
      11: 0.00022  // ~0.025 km
    };

    const hexSize = resolutionToSize[resolution] || resolutionToSize[8];

    // Convert GeoJSON to WKT
    const wkt = wellknown.stringify(geojson);

    // Create GDAL geometry from WKT
    const polygon = gdal.Geometry.fromWKT(wkt);

    // Get the envelope (bounding box) of the polygon
    const envelope = polygon.getEnvelope();
    const { minX, maxX, minY, maxY } = envelope;

    // Calculate hexagon dimensions for flat-top hexagons
    const hexWidth = Math.sqrt(3) * hexSize;
    const hexHeight = 2 * hexSize;

    const centroids = [];

    // Generate hexagonal grid (flat-top)
    let row = 0;
    for (let y = minY; y <= maxY + hexHeight / 2; y += hexHeight * 0.75, row++) {
      const offsetX = (row % 2) * hexWidth / 2;

      for (let x = minX; x <= maxX + hexWidth / 2; x += hexWidth) {
        const centerX = x + offsetX;
        const centerY = y;

        // Create hexagon geometry
        const hexCoords = [];
        const precision = 7;
        for (let i = 0; i < 6; i++) {
          const angle = Math.PI / 3 * i + Math.PI / 6; // Start at 30 degrees for flat top
          const vx = roundCoordinate(centerX + hexSize * Math.cos(angle), precision);
          const vy = roundCoordinate(centerY + hexSize * Math.sin(angle), precision);
          hexCoords.push([vx, vy]);
        }
        hexCoords.push(hexCoords[0]); // Close the ring

        // Create polygon from coordinates
        const hexRing = new gdal.LinearRing();
        hexCoords.forEach(([hx, hy]) => hexRing.points.add(hx, hy));

        const hexPolygon = new gdal.Polygon();
        hexPolygon.rings.add(hexRing);

        // Check if hexagon intersects with the original polygon
        if (hexPolygon.intersects(polygon)) {
          // Get the intersection to verify it's meaningful (not just touching)
          const intersection = hexPolygon.intersection(polygon);
          if (intersection && intersection.getArea() > 0) {
            centroids.push({
              latitude: centerY,
              longitude: centerX
            });
          }
        }
      }
    }

    console.log(`Generated ${centroids.length} hexagon centroids covering the area`);
    return centroids;

  } catch (error) {
    console.error('Error generating hexagon centroids with GDAL:', error.message);
    return [];
  }
}


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
 * Generate cache file path for a postal or area code
 * @param {string} code - Postal code (7 digits) or area code (5, 9-12 digits)
 * @returns {string} Path to cache file
 */
function getCacheFilePath(code) {
  // Normalize the code (remove hyphens and spaces)
  const normalized = code.replace(/[-\s]/g, '');

  // Determine the type based on length
  let cacheType;
  if (normalized.length === 7) {
    cacheType = 'postal';
  } else if (normalized.length === 5 || (normalized.length >= 9 && normalized.length <= 12)) {
    cacheType = 'area';
  } else {
    cacheType = 'other';
  }

  return path.join(CACHE_DIR, `${cacheType}_${normalized}.json.gz`);
}

/**
 * Write compressed cache data
 * @param {string} cachePath - Path to cache file
 * @param {Object} data - Data to cache
 */
async function writeCacheCompressed(cachePath, data) {
  try {
    const jsonString = JSON.stringify(data);
    const compressed = await gzip(jsonString);
    await fs.writeFile(cachePath, compressed);
    console.log(`Cached data compressed to ${cachePath} (${(compressed.length / 1024).toFixed(2)} KB)`);
  } catch (error) {
    console.error('Error writing compressed cache:', error.message);
    throw error;
  }
}

/**
 * Read compressed cache data
 * @param {string} cachePath - Path to cache file
 * @returns {Object|null} Cached data or null if not found
 */
async function readCacheCompressed(cachePath) {
  try {
    const compressed = await fs.readFile(cachePath);
    const decompressed = await gunzip(compressed);
    const data = JSON.parse(decompressed.toString('utf8'));
    console.log(`Loaded compressed cache from ${cachePath}`);
    return data;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('Error reading compressed cache:', error.message);
    }
    return null;
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
  console.log(`Fetching stores from API using Lat: ${centerLat}, Lng: ${centerLng}...`);
  const url = `${API_BASE_URL}/stores?client_id=${CLIENT_ID}&longitude=${centerLng}&latitude=${centerLat}`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`API request failed: ${response.statusText}`);
    }
    const data = await response.json();
    const stores = data.stores;
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
 * Filter stores to only include those with rpay service
 */
function filterRpayStores(stores) {
  return stores.filter(store => {
    if (!store.service_id || !Array.isArray(store.service_id)) {
      return false;
    }
    return store.service_id.includes('rpay');
  });
}

/**
 * Get all stores with details (cached or from API)
 * @param {Object} options - Options object
 * @param {boolean} options.noCache - Skip cache if true
 * @param {number} options.centerLat - Center latitude
 * @param {number} options.centerLng - Center longitude
 * @param {Array} options.centerPoints - Array of center points
 * @param {string} options.postalCode - Postal code (7 digits) for cache naming
 * @param {string} options.areaCode - Area code (9-11 digits) for cache naming
 */
async function getAllStores(options = {}) {
  await ensureCacheDir();

  // Determine cache file path based on postal code or area code
  let cachePath;
  if (options.postalCode) {
    cachePath = getCacheFilePath(options.postalCode);
  } else if (options.areaCode) {
    cachePath = getCacheFilePath(options.areaCode);
  } else {
    // Fallback to old cache name if no code provided
    cachePath = path.join(CACHE_DIR, 'stores_all.json.gz');
  }

  // Check cache first
  if (!options.noCache && await isCacheValid(cachePath)) {
    console.log('Loading stores from compressed cache...');
    const stores = await readCacheCompressed(cachePath);
    if (stores) {
      console.log(`Loaded ${stores.length} stores from cache`);
      return stores;
    }
  }

  let allFetchedStores = [];
  const pointsToFetch = options.centerPoints && options.centerPoints.length > 0
    ? options.centerPoints
    : [{ latitude: options.centerLat, longitude: options.centerLng }];

  console.log(`Fetching stores from API for ${pointsToFetch.length} location(s)...`);

  for (const point of pointsToFetch) {
    const stores = await fetchStoresFromAPI(point.latitude, point.longitude);
    if (stores && stores.length > 0) {
      allFetchedStores = allFetchedStores.concat(stores);
    }
  }

  // Deduplicate stores by map_store_id
  const uniqueStoresMap = new Map();
  for (const store of allFetchedStores) {
    if (store.map_store_id) {
      uniqueStoresMap.set(store.map_store_id, store);
    }
  }
  let stores = Array.from(uniqueStoresMap.values());

  stores = filterRpayStores(stores);
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

  // Save to compressed cache
  await writeCacheCompressed(cachePath, storesWithDetails);
  console.log(`Cached ${storesWithDetails.length} stores in compressed format`);

  return storesWithDetails;
}

/**
 * Load and parse postal code data from ZIP file
 */
async function loadPostalData() {
  const zipPath = path.join(__dirname, 'zipcode', 'dl', 'utf', 'zip', 'utf_ken_all.zip');

  try {
    const zip = new AdmZip(zipPath);
    const zipEntries = zip.getEntries();

    if (zipEntries.length === 0) {
      throw new Error('No files found in ZIP archive');
    }

    const csvEntry = zipEntries[0];
    const buffer = csvEntry.getData();
    const csvText = iconv.decode(buffer, 'utf8');
    const lines = csvText.split('\n');

    const postalData = {};

    for (const line of lines) {
      if (!line.trim()) continue;

      const parts = line.split(',').map(p => p.trim().replace(/^"|"$/g, ''));
      if (parts.length >= 9) {
        const postalCode = parts[2];
        const prefecture = parts[6];
        const city = parts[7];
        const address = parts[8];

        if (!postalData[postalCode]) {
          postalData[postalCode] = [];
        }

        postalData[postalCode].push({
          postalCode,
          prefecture,
          city,
          address
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
 * Filter stores by whether they are inside a GeoJSON polygon
 * @param {Array} stores - Array of store objects
 * @param {Object} geojson - GeoJSON polygon or multipolygon
 * @returns {Array} Filtered array of stores
 */
function filterStoresByGeoJSON(stores, geojson) {
  if (!geojson) return [];

  try {
    const wkt = wellknown.stringify(geojson);
    const polygon = gdal.Geometry.fromWKT(wkt);

    return stores.filter(store => {
      if (typeof store.latitude !== 'number' || typeof store.longitude !== 'number') {
        return false;
      }

      const point = new gdal.Point(store.longitude, store.latitude);
      return polygon.contains(point);
    });
  } catch (error) {
    console.error('Error filtering stores by GeoJSON:', error.message);
    return [];
  }
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
 * Escape special XML characters in a string.
 */
const escapeTags = (str) => {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
};

/**
 * Generate KML file from ordered stores
 * @param {Array} orderedStores - Array of store objects, ordered for the route
 * @param {Object} options - Options for KML generation
 * @param {string} [options.postalCode] - Postal code for the route
 * @param {Object} [options.postalInfo] - Information about the postal code
 * @param {string} [options.areaCode] - Area code for the route
 * @param {string} [options.areaLabel] - Label for the area
 * @param {Array} [options.hexagons] - Array of hexagon polygon geometries to overlay
 * @returns {string} KML content
 */
function generateKML(orderedStores, options = {}) {
  const { postalCode, postalInfo, areaCode, areaLabel, hexagons } = options;

  let kml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  kml += '<kml xmlns="http://www.opengis.net/kml/2.2">\n';
  kml += '<Document>\n';

  if (postalCode) {
    kml += `  <name>Rpay Stores Route - ${escapeTags(postalCode)}</name>\n`;
    if (postalInfo && postalInfo.length > 0) {
      const info = postalInfo[0];
      kml += `  <description>Route for postal code ${escapeTags(postalCode)} (${escapeTags(info.prefecture)} ${escapeTags(info.city)} ${escapeTags(info.address)})</description>\n`;
    } else {
      kml += `  <description>Route for postal code ${escapeTags(postalCode)}</description>\n`;
    }
  } else if (areaCode) {
    kml += `  <name>Rpay Stores in Area - ${escapeTags(areaLabel || areaCode)}</name>\n`;
    kml += `  <description>Stores within area code ${escapeTags(areaCode)} (${escapeTags(areaLabel || '')})</description>\n`;
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

  kml += '  <Style id="hexagonStyle">\n';
  kml += '    <LineStyle>\n';
  kml += '      <color>ff00aaff</color>\n'; // Orange outline
  kml += '      <width>2</width>\n';
  kml += '    </LineStyle>\n';
  kml += '    <PolyStyle>\n';
  kml += '      <color>3300aaff</color>\n'; // Semi-transparent orange fill (33 = ~20% opacity)
  kml += '    </PolyStyle>\n';
  kml += '  </Style>\n';

  // Add hexagon tessellation overlay if provided
  if (hexagons && hexagons.length > 0) {
    kml += '  <Folder>\n';
    kml += '    <name>Hexagon Tessellation</name>\n';
    kml += '    <description>Hexagonal grid covering the area</description>\n';

    hexagons.forEach((hex, index) => {
      const { geometry } = hex;

      // Convert GeoJSON coordinates to KML format
      let coordinates = '';
      if (geometry.type === 'Polygon') {
        const ring = geometry.coordinates[0];
        ring.forEach(([lon, lat]) => {
          coordinates += `${lon},${lat},0 `;
        });
      }

      if (coordinates) {
        kml += '    <Placemark>\n';
        kml += `      <name>Hexagon ${index + 1}</name>\n`;
        kml += '      <styleUrl>#hexagonStyle</styleUrl>\n';
        kml += '      <Polygon>\n';
        kml += '        <outerBoundaryIs>\n';
        kml += '          <LinearRing>\n';
        kml += '            <coordinates>\n';
        kml += `              ${coordinates.trim()}\n`;
        kml += '            </coordinates>\n';
        kml += '          </LinearRing>\n';
        kml += '        </outerBoundaryIs>\n';
        kml += '      </Polygon>\n';
        kml += '    </Placemark>\n';
      }
    });

    kml += '  </Folder>\n';
  }

  // Add placemarks for each store
  orderedStores.forEach((store, index) => {
    const isFirst = index === 0;
    const styleId = isFirst ? 'startPoint' : 'storePoint';

    kml += '  <Placemark>\n';
    kml += `    <name>${index + 1}. ${escapeTags(store.store_name)}</name>\n`;
    kml += '    <description>';
    kml += `Store ID: ${escapeTags(String(store.map_store_id))}\\n`;
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

async function main() {
  const program = new Command();

  program
    .name('kml-generator')
    .description('Generate KML files for rpay stores based on Japanese postal codes or area codes')
    .version('1.3.0')
    .argument('<code>', 'Japanese postal code (7 digits, e.g., 100-0001) or area code (5/9/11/12 digits, e.g., 13101, 131010001)')
    .option('-o, --output <file>', 'Output KML file path')
    .option('--geojson-output <file>', 'Output GeoJSON file path for hexagons')
    .option('--area-geojson-output <file>', 'Output GeoJSON file path for the geocoded area geometry')
    .option('--geojson-only', 'Only generate GeoJSON files, skip store fetching and KML generation')
    .option('-c, --cache', 'Enable caching for API calls (default: disabled)')
    .option('--center-lat <latitude>', 'Override center latitude for store search', parseFloat)
    .option('--center-lng <longitude>', 'Override center longitude for store search', parseFloat)
    .option('--h3-resolution <resolution>', 'Hexagonal tessellation resolution level 7-11 (default: 8, ~460m hexagons)', parseInt, 8)
    .option('--no-hexagons', 'Disable hexagonal tessellation overlay in KML output')
    .option('--no-optimize', 'Skip route optimization (for postal codes)')
    .action(async (code, options) => {
      try {
        console.log(`\n🗾 Rpay Store KML Generator`);
        console.log(`=====================================\n`);

        const normalizedCode = code.replace(/[-\s]/g, '');
        const isPostalCode = normalizedCode.length === 7;
        const isAreaCode = [5, 9, 11].includes(normalizedCode.length);

        let orderedStores = [];
        let kml;
        let outputPath;
        let hexagonPolygons = []; // Store hexagon polygons for visualization

        if (isAreaCode) {
          // --- Area Code Logic ---
          console.log(`Processing as Area Code: ${code}`);

          if (!options.geojsonOutput) {
            options.geojsonOutput = `h${code}.geojson`;
            console.log(`Defaulting --geojson-output to ${options.geojsonOutput}`);
          }
          if (!options.areaGeojsonOutput) {
            options.areaGeojsonOutput = `a${code}.geojson`;
            console.log(`Defaulting --area-geojson-output to ${options.areaGeojsonOutput}`);
          }

          console.log(`\n🌍 Geocoding area code ${code}...`);
          const geocodeResults = await geocodeAreaCode(code);

          if (!geocodeResults || geocodeResults.length === 0) {
            console.error(`\n❌ Could not geocode area code ${code}.`);
            process.exit(1);
          }

          // Combine all geojson results into one FeatureCollection for area output
          const allGeometries = geocodeResults.map(r => r.geojson).filter(Boolean);
          if (options.areaGeojsonOutput && allGeometries.length > 0) {
            const featureCollection = {
              type: 'FeatureCollection',
              features: allGeometries.map((geom, index) => ({
                type: 'Feature',
                geometry: geom,
                properties: { id: index, label: geocodeResults[index].label }
              }))
            };
            console.log(`\n📄 Generating GeoJSON file for ${allGeometries.length} area geometries...`);
            await fs.writeFile(options.areaGeojsonOutput, JSON.stringify(featureCollection, null, 2), 'utf8');
            console.log(`\n✅ Area GeoJSON file generated successfully!`);
            console.log(`   File: ${path.resolve(options.areaGeojsonOutput)}`);
          }

          let centerPoints = [];
          
          if (geocodeResults.length > 0 && !options.noHexagons) {
            console.log(`\n🔷 Combining ${geocodeResults.length} geometries for tessellation...`);
            
            // Use GDAL to combine all geometries into a single MultiPolygon
            const allGeometries = geocodeResults.map(r => r.geojson).filter(Boolean);
            const gdalGeometries = allGeometries.map(geom => gdal.Geometry.fromGeoJson(geom));
            
            let combinedGeometry = null;
            if (gdalGeometries.length > 0) {
              combinedGeometry = gdalGeometries[0];
              for (let i = 1; i < gdalGeometries.length; i++) {
                combinedGeometry = combinedGeometry.union(gdalGeometries[i]);
              }
            }
            
            // Check if the combined geometry is valid and has an area
            if (combinedGeometry && !combinedGeometry.isEmpty() && combinedGeometry.getArea() > 0) {
              const combinedWkt = combinedGeometry.toWKT();
              const combinedGeoJson = wellknown.parse(combinedWkt);

              console.log(`\n🔷 Generating hexagon tessellation for combined geometry (resolution: ${options.h3Resolution})...`);
              hexagonPolygons = generateHexagonPolygons(combinedGeoJson, options.h3Resolution);
              
              hexagonPolygons.forEach(h => {
                const vertices = h.geometry.coordinates[0]; // Array of [lon, lat]
                // The last vertex is a duplicate to close the polygon, so we skip it.
                for (let i = 0; i < vertices.length - 1; i++) {
                    const [lon, lat] = vertices[i];
                    centerPoints.push({ latitude: lat, longitude: lon });
                }
              });
            } else {
                console.warn('Combined geometry is empty or invalid, skipping hexagon generation.');
            }
          }

          // If no center points were generated at all from hexagons, use the centroid of the first geometry.
          if (centerPoints.length === 0 && geocodeResults.length > 0) {
            const { latitude, longitude } = geocodeResults[0];
            centerPoints.push({ latitude, longitude });
          }

          if (options.geojsonOutput && hexagonPolygons.length > 0) {
            console.log(`\n📄 Generating GeoJSON file for hexagons...`);
            const features = hexagonPolygons.map((hex, index) => ({
              type: 'Feature',
              geometry: hex.geometry,
              properties: {
                id: index,
                center_lat: hex.center.latitude,
                center_lon: hex.center.longitude
              }
            }));
            const featureCollection = {
              type: 'FeatureCollection',
              features
            };
            await fs.writeFile(options.geojsonOutput, JSON.stringify(featureCollection, null, 2), 'utf8');
            console.log(`\n✅ GeoJSON file generated successfully!`);
            console.log(`   File: ${path.resolve(options.geojsonOutput)}`);
          }

          if (options.geojsonOnly) {
              console.log('\n✅ GeoJSON generation complete. Exiting as requested.');
              process.exit(0);
          }
          // If still no center points, and no geocode results, something is wrong, but handled by earlier exit.
          // If centerPoints is still empty after this, need to ensure fetchStoresFromAPI can handle it.
          // It already has default lat/lng.

          console.log('\n🏪 Fetching store data...');
          const allStores = await getAllStores({
            noCache: !options.cache,
            centerPoints,
            areaCode: normalizedCode
          });

          console.log(`\n🔍 Filtering stores within the area geometries...`);
          let filteredStores = [];
          for (const result of geocodeResults) {
              const storesInGeom = filterStoresByGeoJSON(allStores, result.geojson);
              // Simple concat, might have duplicates if geometries overlap
              filteredStores.push(...storesInGeom);
          }
          // Deduplicate stores
          const uniqueStoreIds = new Set();
          filteredStores = filteredStores.filter(store => {
            if (uniqueStoreIds.has(store.map_store_id)) {
              return false;
            } else {
              uniqueStoreIds.add(store.map_store_id);
              return true;
            }
          });
          console.log(`   Found ${filteredStores.length} unique stores.`);
          
          if (filteredStores.length === 0) {
            console.log('\n❌ No stores found for this area code.');
            process.exit(0);
          }

          // For area codes, we just list the stores, no route optimization by default
          orderedStores = filteredStores.sort((a, b) => a.store_name.localeCompare(b.store_name));
          
          console.log('\n📄 Generating KML file...');
          kml = generateKML(orderedStores, {
            areaCode: code,
            areaLabel: geocodeResults[0].label, // Use label from the first geometry
            hexagons: options.noHexagons !== true ? hexagonPolygons : []
          });
          outputPath = options.output || `stores_in_area_${normalizedCode}.kml`;


        } else if (isPostalCode) {
          // --- Postal Code Logic ---
          console.log(`Processing as Postal Code: ${code}`);
          const postalData = await loadPostalData();
          const postalInfo = postalData[normalizedCode];

          if (postalInfo && postalInfo.length > 0) {
            const info = postalInfo[0];
            console.log(`   Address: ${info.prefecture} ${info.city} ${info.address}`);
          } else {
            console.warn(`   Warning: Postal code ${normalizedCode} not found in database.`);
          }

          let centerLat = options.centerLat;
          let centerLng = options.centerLng;
          let centerPoints = [];

          if ((!centerLat || !centerLng) && postalInfo) {
            console.log(`\n🌍 Geocoding postal code ${normalizedCode}...`);
            const geocodeResult = await geocodePostalCode(normalizedCode, postalInfo);
            if (geocodeResult) {
              centerLat = geocodeResult.latitude;
              centerLng = geocodeResult.longitude;
              if (geocodeResult.geojson && options.h3Resolution) {
                console.log(`\n🔷 Generating hexagon tessellation (resolution: ${options.h3Resolution})...`);
                hexagonPolygons = generateHexagonPolygons(geocodeResult.geojson, options.h3Resolution);
                centerPoints = hexagonPolygons.map(h => h.center);
              }
            }
          }
          
          if (options.geojsonOutput && hexagonPolygons.length > 0) {
            console.log(`\n📄 Generating GeoJSON file for hexagons...`);
            const features = hexagonPolygons.map((hex, index) => ({
              type: 'Feature',
              geometry: hex.geometry,
              properties: {
                id: index,
                center_lat: hex.center.latitude,
                center_lon: hex.center.longitude
              }
            }));
            const featureCollection = {
              type: 'FeatureCollection',
              features
            };
            await fs.writeFile(options.geojsonOutput, JSON.stringify(featureCollection, null, 2), 'utf8');
            console.log(`\n✅ GeoJSON file generated successfully!`);
            console.log(`   File: ${path.resolve(options.geojsonOutput)}`);
          }

          if (options.geojsonOnly) {
              console.log('\n✅ GeoJSON generation complete. Exiting as requested.');
              process.exit(0);
          }

          console.log('\n🏪 Fetching store data...');
          const allStores = await getAllStores({
            noCache: !options.cache,
            centerLat,
            centerLng,
            centerPoints,
            postalCode: normalizedCode
          });

          console.log(`\n🔍 Filtering stores by postal code ${normalizedCode}...`);
          let filteredStores = filterStoresByPostalCode(allStores, normalizedCode);
          console.log(`   Found ${filteredStores.length} stores.`);

          if (filteredStores.length === 0) {
            console.log('\n❌ No stores found for this postal code.');
            process.exit(0);
          }

          if (options.noOptimize) {
            orderedStores = filteredStores;
            console.log('\n🚫 Route optimization skipped.');
          } else {
            console.log('\n🚀 Optimizing route...');
            orderedStores = orderStoresNearestNeighbor(filteredStores, centerLat, centerLng);
          }
          
          console.log('\n📄 Generating KML file...');
          kml = generateKML(orderedStores, {
            postalCode: code,
            postalInfo,
            hexagons: options.hexagons !== false ? hexagonPolygons : []
          });
          outputPath = options.output || `route_${normalizedCode}.kml`;

        } else {
          console.error(`\n❌ Invalid code format: "${code}"`);
          console.error('Please provide a 5, 7, 9, 10, 11, or 12-digit area code.');
          process.exit(1);
        }

        await fs.writeFile(outputPath, kml, 'utf8');

        console.log(`\n✅ KML file generated successfully!`);
        console.log(`   File: ${path.resolve(outputPath)}`);
        console.log(`   Stores: ${orderedStores.length}`);
        console.log(`\n📋 Store list:`);
        orderedStores.forEach((store, idx) => {
          console.log(`   ${idx + 1}. ${escapeTags(store.store_name)}`);
        });

        console.log(`\n💡 Import this KML file into Google Maps to view the route.\n`);

      } catch (error) {
        console.error('\n❌ An unexpected error occurred:', error.message);
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
  loadPostalData,
  generateHexagonPolygons,
  generateHexagonCentroids,
  geocodeAreaCode,
  geocodePostalCode
};
