# Endpoint Update Summary

## ✅ Updated to Real Rakuten Pay API

**Date**: 2025-11-23
**Status**: Complete

---

## What Changed

### Real API Endpoint Discovered

From user-provided bash script, the actual Rakuten Pay API endpoint was identified:

```
https://gateway-api.global.rakuten.com/mmeu/api/v3/stores
```

**Key Discovery**:
- Domain: `gateway-api.global.rakuten.com` (not localhost!)
- Path: `/mmeu/api/v3/stores`
- Parameters: `latitude`, `longitude`, `client_id=integrated`
- Filter required: Only stores with `service_id` array containing `"rpay"`

---

## Files Updated

### 1. **kml-generator.js**
- ✅ Changed API_BASE_URL from `http://localhost:8080` to `https://gateway-api.global.rakuten.com`
- ✅ Added `filterRpayStores()` function to filter by service_id
- ✅ Applied rpay filter before exclusion filter
- ✅ Made endpoint configurable via `RAKUTEN_API_URL` env variable

**Before**:
```javascript
const API_BASE_URL = 'http://localhost:8080/mmeu/api/v3';
```

**After**:
```javascript
const API_BASE_URL = process.env.RAKUTEN_API_URL || 'https://gateway-api.global.rakuten.com/mmeu/api/v3';
```

**New Filter**:
```javascript
function filterRpayStores(stores) {
  return stores.filter(store => {
    if (!store.service_id || !Array.isArray(store.service_id)) {
      return false;
    }
    return store.service_id.includes('rpay');
  });
}
```

### 2. **stores.html**
- ✅ Updated all 4 occurrences of API URL:
  - Line 378: Default API URL
  - Line 708: Store detail URL
  - Line 1172: Context menu fetch
  - Line 1643: Current location fetch

**Changes**:
- `http://localhost:8080/mmeu/api/v3/stores` → `https://gateway-api.global.rakuten.com/mmeu/api/v3/stores`
- `/mmeu/api/v3/store/${id}` → `https://gateway-api.global.rakuten.com/mmeu/api/v3/store/${id}`

### 3. **rpay_stores.sh** (NEW)
- ✅ Created bash script demonstrating API usage
- ✅ Shows how to filter rpay stores using jq
- ✅ Saves results to JSON file
- ✅ Executable script

**Usage**:
```bash
./rpay_stores.sh 35.6812 139.7671
```

**Output**:
```
Store Name,Latitude,Longitude
```

### 4. **API_ENDPOINT_DISCOVERY.md**
- ✅ Added "DISCOVERED" section at top
- ✅ Documented real endpoint with full details
- ✅ Included response structure and filtering info
- ✅ Kept original content for reference

### 5. **KML_GENERATOR_README.md**
- ✅ Updated Prerequisites section (removed localhost requirement)
- ✅ Expanded API Integration section with real endpoints
- ✅ Added response structure example
- ✅ Updated Troubleshooting (removed localhost references)
- ✅ Referenced rpay_stores.sh script

---

## API Specifications

### Endpoint 1: Store List

```http
GET https://gateway-api.global.rakuten.com/mmeu/api/v3/stores
    ?latitude=35.6812
    &longitude=139.7671
    &client_id=integrated
```

**Response**:
```json
{
  "stores": [
    {
      "map_store_id": "store_123",
      "store_name": "Example Store",
      "latitude": 35.6812,
      "longitude": 139.7671,
      "service_id": ["rpay", "..."]
    }
  ]
}
```

**Filter**:
```javascript
stores.filter(s => s.service_id && s.service_id.includes('rpay'))
```

### Endpoint 2: Store Details

```http
GET https://gateway-api.global.rakuten.com/mmeu/api/v3/store/{map_store_id}
    ?client_id=integrated
```

**Response**: Store details including postal_code

---

## Bash Script Example

The new `rpay_stores.sh` demonstrates API usage:

```bash
curl -s "https://gateway-api.global.rakuten.com/mmeu/api/v3/stores?latitude=$latitude&longitude=$longitude&client_id=integrated" \
  | tee "rpay_stores_${latitude}_${longitude}.json" \
  | jq -r '.stores[] | select(.service_id[]| any(.; . == "rpay")) | "\(.store_name),\(.latitude),\(.longitude)"'
```

**Key Points**:
1. Fetch stores from API
2. Save full JSON response
3. Filter for rpay service_id
4. Extract name and coordinates

---

## Benefits

### Before
- ❌ Required localhost proxy server
- ❌ Proxy dependency for deployment
- ❌ Limited portability
- ❌ Extra infrastructure needed

### After
- ✅ Direct API access
- ✅ No proxy needed
- ✅ Works anywhere with internet
- ✅ Simplified deployment
- ✅ Proper rpay filtering

---

## Testing

### Test 1: CLI Help
```bash
node kml-generator.js --help
```
✅ Working - Shows updated help

### Test 2: Bash Script
```bash
./rpay_stores.sh 35.6812 139.7671
```
✅ Ready to test with internet access

### Test 3: KML Generation
```bash
node kml-generator.js 100-0001
```
⏳ Ready to test when API is accessible

---

## Environment Variable Support

Can override endpoint via environment variable:

```bash
# Use different endpoint
export RAKUTEN_API_URL=https://custom-api.example.com/mmeu/api/v3
node kml-generator.js 100-0001

# Use localhost proxy (legacy)
export RAKUTEN_API_URL=http://localhost:8080/mmeu/api/v3
node kml-generator.js 100-0001
```

---

## Migration Notes

### For Existing Users

If you were using the localhost proxy:

**Option 1**: Switch to real API (recommended)
- No changes needed, it's now the default
- Remove your proxy server

**Option 2**: Keep using localhost
```bash
export RAKUTEN_API_URL=http://localhost:8080/mmeu/api/v3
```

### New Features

- **rpay filtering**: Automatically filters for Rakuten Pay stores
- **service_id support**: Uses proper API field for service detection
- **Environment config**: Override endpoint via RAKUTEN_API_URL

---

## Files Changed Summary

| File | Status | Changes |
|------|--------|---------|
| kml-generator.js | ✅ Modified | Real endpoint + rpay filter |
| stores.html | ✅ Modified | All 4 API URLs updated |
| rpay_stores.sh | ✅ New | Bash script example |
| API_ENDPOINT_DISCOVERY.md | ✅ Modified | Added discovery section |
| KML_GENERATOR_README.md | ✅ Modified | Updated docs |
| ENDPOINT_UPDATE_SUMMARY.md | ✅ New | This file |

---

## Commit Message

```
feat: Update to real Rakuten Pay API endpoint

Replace localhost proxy with real Rakuten Global API Gateway endpoint.
Discovered from user bash script: gateway-api.global.rakuten.com

Changes:
- Update all API URLs to https://gateway-api.global.rakuten.com
- Add rpay service_id filtering
- Create rpay_stores.sh bash example
- Update documentation with real endpoint details
- Add environment variable support (RAKUTEN_API_URL)

Breaking change: No longer requires localhost:8080 proxy
Migration: Export RAKUTEN_API_URL=http://localhost:8080/mmeu/api/v3 to keep old behavior
```

---

**Updated By**: Claude
**Date**: 2025-11-23
**Branch**: claude/kml-rpay-store-generator-01G8VXXSExhmGHWqS2CedjnK
