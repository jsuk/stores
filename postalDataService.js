// IndexedDB helper functions
const dbName = 'PostalDataDB';
const storeName = 'postalCodes';

function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(storeName)) {
                db.createObjectStore(storeName, { keyPath: 'postalCode' });
            }
        };
        request.onsuccess = (event) => {
            resolve(event.target.result);
        };
        request.onerror = (event) => {
            reject('IndexedDB error: ' + event.target.errorCode);
        };
    });
}

async function saveDataToDB(data) {
    const db = await openDB();
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    Object.keys(data).forEach(postalCode => {
        store.put({ postalCode, data: data[postalCode] });
    });
    return transaction.complete;
}

let postalCodeAddressCache = null;

async function getDataFromDB() {
    if (postalCodeAddressCache) {
        logDebug('Using in-memory postal code address cache.');
        return postalCodeAddressCache;
    }
    const db = await openDB();
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const allRecords = await new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });

    const postalData = {};
    allRecords.forEach(record => {
        postalData[record.postalCode] = record.data;
    });
    postalCodeAddressCache = postalData;
    return postalData;
}

// Function to fetch, unzip, and cache the postal code data
async function fetchAndCachePostalData() {
    const cacheTimestampKey = 'postal_data_ken_all_rome_timestamp';
    const cacheDuration = 24 * 60 * 60 * 1000; // 24 hours

    const cachedTimestamp = localStorage.getItem(cacheTimestampKey);

    if (cachedTimestamp && (new Date().getTime() - cachedTimestamp < cacheDuration)) {
        logDebug('Using cached postal data from IndexedDB.');
        return await getDataFromDB();
    }

    try {
        if (typeof JSZip === 'undefined') {
            throw new Error('JSZip library is not loaded. Cannot unzip the file.');
        }
        logDebug('Fetching postal data zip file...');
        // showLoading(); // This function is specific to stores.html, so remove it here
	// substring of window.location.href up to the last '/'
        const lastSlashIndex = window.location.href.lastIndexOf('/');
	if (lastSlashIndex === -1) {
	    throw new Error('Invalid URL: No slash found in the URL.');
	}
	const baseUrl = window.location.href.substring(0, lastSlashIndex + 1);

        const response = await fetch(baseUrl + 'zipcode/dl/roman/KEN_ALL_ROME.zip');
        if (!response.ok) {
            throw new Error(`Failed to fetch zip file: ${response.statusText}`);
        }
        const zipBlob = await response.blob();
        logDebug('Zip file fetched. Unzipping...');

        const jszip = new JSZip();
        const zip = await jszip.loadAsync(zipBlob);
        const csvFileName = Object.keys(zip.files)[0];
        if (!csvFileName) {
            throw new Error('No file found in the zip archive.');
        }

        logDebug(`Unzipping file: ${csvFileName}`);
        const csvContentUint8Array = await zip.files[csvFileName].async('uint8array');
        const decoder = new TextDecoder('shift-jis');
        const csvContent = decoder.decode(csvContentUint8Array);
        logDebug('CSV content extracted. Parsing...');

        // Simple CSV parser
        const lines = csvContent.split('\n');
        const postalData = {};
        for (const line of lines) {
            const parts = line.split(',').map(item => item.trim().replace(/"/g, ''));
            if (parts.length >= 3) {
                const postalCode = parts[0];
                const prefecture = parts[1];
                const city = parts[2];
                const address = parts[3] || '';
                if (!postalData[postalCode]) {
                    postalData[postalCode] = [];
                }
                const prefecture_rome = (parts.length > 4 && parts[4] !== null) ? parts[4] : '';
                const city_rome = (parts.length > 5 && parts[5] !== null) ? parts[5] : '';
                const address_rome = (parts.length > 6 && parts[6] !== null) ? parts[6] : '';
                postalData[postalCode].push({ prefecture, city, address, prefecture_rome, city_rome, address_rome });
            }
        }

        logDebug('Parsing complete. Caching data to IndexedDB...');
        await saveDataToDB(postalData);
        localStorage.setItem(cacheTimestampKey, new Date().getTime());
        logDebug('Postal data cached successfully in IndexedDB.');
        return postalData; // Return newly fetched data
    } catch (error) {
        logDebug(`Error fetching or processing postal data: ${error}`);
        console.error('Error fetching or processing postal data:', error);
        return null; // Return null on error
    } finally {
        // hideLoading(); // This function is specific to stores.html, so remove it here
    }
}

async function clearAllCache() {
    // Clear IndexedDB
    // Clear cacheTimestamp as well
    localStorage.removeItem('postal_data_ken_all_rome_timestamp');
    return new Promise((resolve, reject) => {
        const request = indexedDB.deleteDatabase(dbName);
        request.onsuccess = () => {
            logDebug('IndexedDB cleared.');
            // Clear localStorage timestamp
            localStorage.removeItem('postal_data_ken_all_rome_timestamp');
            logDebug('LocalStorage timestamp cleared.');
            // Clear in-memory cache
            postalCodeAddressCache = null;
            logDebug('In-memory cache cleared.');
            resolve();
        };
        request.onerror = (event) => {
            reject('Error clearing IndexedDB: ' + event.target.errorCode);
        };
    });
}

// Function to get postal data from cache
async function getPostalData(postalCode) {
    const postalData = await getDataFromDB();
    return postalData[postalCode] || null;
}

// Function to display a sample of the cached postal data (can be removed if not needed in query.html)
function displayCachedDataSample(postalData) {
    const sampleContainer = document.getElementById('postal-data-sample');
    if (!sampleContainer) return;

    if (postalData && Object.keys(postalData).length > 0) {
        const first10Entries = Object.entries(postalData).slice(0, 10);
        const logMessage = 'logDebug: Displayed sample of cached postal data.';
        sampleContainer.textContent = logMessage + '\n\n' + JSON.stringify(first10Entries, null, 2);
        logDebug('Displayed sample of cached postal data.');
    } else if (postalData) {
        const logMessage = 'logDebug: Cached postal data was found but is empty.';
        sampleContainer.textContent = logMessage;
        logDebug('Cached postal data was found but is empty.');
    } else {
        const logMessage = 'logDebug: No cached data found or failed to fetch.';
        sampleContainer.textContent = logMessage;
        logDebug('No postal data available to display as sample.');
    }
}

async function getPostalCodeFromAddress(prefecture, city, address) {
    const allPostalData = await getDataFromDB();
    for (const postalCode in allPostalData) {
        const entries = allPostalData[postalCode];
        for (const entry of entries) {
            // Simple matching for now, can be improved with fuzzy matching or more robust logic
            if (entry.prefecture === prefecture && entry.city === city && entry.address.includes(address)) {
                return postalCode;
            }
        }
    }
    return null; // No matching postal code found
}

async function searchPostalCodesByPartialAddress(prefectureTerm, cityTerm, areaTerm) {
    const allPostalData = await getDataFromDB();
    const matches = new Map(); // Use a Map to store unique postal codes and their best matching address and match length

    const cleanedPrefectureTerm = prefectureTerm.replace(/\s/g, '').toLowerCase();
    const cleanedCityTerm = cityTerm.replace(/\s/g, '').toLowerCase();
    const cleanedAreaTerm = areaTerm.replace(/\s/g, '').toLowerCase();

    // Generate all possible contiguous substrings of the cleaned area term.
    // This allows for more flexible matching against partial inputs.
    // The minimum length of areaTerm substring is 2 characters.
    const areaSearchSubstrings = new Set(); // Use a Set to avoid duplicate substrings
    if (cleanedAreaTerm.length > 0) {
        for (let i = 0; i < cleanedAreaTerm.length; i++) {
            for (let j = i + 1; j <= cleanedAreaTerm.length; j++) {
                if (j - i < 2) continue; // Skip substrings shorter than 2 characters
                areaSearchSubstrings.add(cleanedAreaTerm.substring(i, j));
            }
        }
    } else {
        areaSearchSubstrings.add(''); // Allow matching all areas if no areaTerm is provided
    }

    // Iterate through all postal data and check if any part of the address contains any of the generated substrings.
    for (const postalCode in allPostalData) {
        const entries = allPostalData[postalCode];
        for (const entry of entries) {
            const entryPrefecture = entry.prefecture.toLowerCase();
            const entryCity = entry.city.toLowerCase();
            const entryAddress = entry.address.toLowerCase();

            // Check for prefecture and city match (exact or includes, let's use includes for flexibility)
            const prefectureMatches = cleanedPrefectureTerm === '' || entryPrefecture.includes(cleanedPrefectureTerm);
            const cityMatches = cleanedCityTerm === '' || entryCity.includes(cleanedCityTerm);

            if (prefectureMatches && cityMatches) {
                // Now check for area name substrings
                for (const sub of areaSearchSubstrings) {
                    if (entryAddress.includes(sub)) {
                        // If a match is found, store the postal code, address details, and the length of the matching substring.
                        // If a postal code already exists, update it only if the new match has a longer substring.
                        const currentMatch = matches.get(postalCode);
                        if (!currentMatch || sub.length > currentMatch.matchLength) {
                            matches.set(postalCode, { postalCode, prefecture: entry.prefecture, city: entry.city, address: entry.address, prefecture_rome: entry.prefecture_rome, city_rome: entry.city_rome, address_rome: entry.address_rome, matchLength: sub.length, matchedAreaLength: entryAddress.length });
                        }
                    }
                }
            }
        }
    }
    
    // Convert map values to an array and sort by matchLength in descending order
    const sortedResults = Array.from(matches.values()).sort((a, b) => {
        // Primary sort: descending order of matchLength
        if (b.matchLength !== a.matchLength) {
            return b.matchLength - a.matchLength;
        }
        // Secondary sort: ascending order of absolute difference between matchLength and matchedAreaLength
        const diffA = Math.abs(a.matchLength - a.matchedAreaLength);
        const diffB = Math.abs(b.matchLength - b.matchedAreaLength);
        return diffA - diffB;
    });
    return sortedResults;
}
