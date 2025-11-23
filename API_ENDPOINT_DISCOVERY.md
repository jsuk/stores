# Rakuten Pay Store API Endpoint Discovery Guide

## Current Status

Your application uses:
```
http://localhost:8080/mmeu/api/v3/stores?client_id=integrated&longitude={lng}&latitude={lat}
http://localhost:8080/mmeu/api/v3/store/{map_store_id}?client_id=integrated
```

**Issue**: These are localhost endpoints, suggesting a proxy/middleware service that interfaces with Rakuten Pay's actual API.

## Research Summary

### ❌ No Public API Documentation Found

After extensive searching, **Rakuten Pay does not provide public API documentation** for their store location/map feature.

**Available Rakuten APIs** (not applicable):
- [Rakuten Web Service](https://webservice.rakuten.co.jp/documentation) - Marketplace/shopping products
- [Rakuten Marketplace API](https://medium.com/rakuten-rapidapi/rakuten-marketplace-api-b3a42367cb43) - E-commerce products
- Payment integration APIs - For merchants accepting payments

### 🔒 Access Restrictions

The Rakuten Pay store map page:
- URL: `https://pay.rakuten.co.jp/shop/map/`
- Returns 403 Forbidden for automated requests
- Likely uses internal/private APIs

## How to Discover the Real Endpoints

### Method 1: Browser Network Inspection (Recommended)

#### Step-by-Step:

1. **Open the page**:
   ```
   https://pay.rakuten.co.jp/shop/map/?scid=wi_rpay_app_menu_map&access_from=shopperapp_android&v=2020113000
   ```

2. **Open Developer Tools**:
   - Chrome/Edge: `F12` or `Ctrl+Shift+I` (Windows) / `Cmd+Option+I` (Mac)
   - Firefox: `F12` or `Ctrl+Shift+E`

3. **Go to Network Tab**:
   - Clear existing requests (🚫 icon)
   - Filter by `XHR` or `Fetch`
   - Enable "Preserve log"

4. **Interact with the Map**:
   - Search for a location
   - Zoom in/out
   - Pan around
   - Click on stores

5. **Analyze Network Requests**:
   Look for requests matching these patterns:

   **Common Patterns**:
   ```
   GET https://pay.rakuten.co.jp/api/stores?...
   GET https://api.rakuten.co.jp/shop/search?...
   GET https://map.rakuten.co.jp/v1/locations?...
   POST https://pay.rakuten.co.jp/api/v2/shop/nearby
   ```

   **Query Parameters to Note**:
   ```
   ?latitude=35.6812
   &longitude=139.7671
   &radius=5000
   &limit=100
   &client_id=...
   &app_id=...
   ```

6. **Inspect Request Details**:
   - **Headers**: Look for authentication (API keys, tokens)
   - **Cookies**: May contain session/auth data
   - **Request Body**: For POST requests
   - **Response**: Check JSON structure

### Method 2: JavaScript Source Analysis

1. **View Page Source**:
   - Right-click → "View Page Source"
   - Or press `Ctrl+U` / `Cmd+Option+U`

2. **Look for JavaScript Files**:
   ```html
   <script src="/assets/js/map.js"></script>
   <script src="/static/store-finder.js"></script>
   ```

3. **Search in JavaScript**:
   - Open each JS file in browser
   - Search for (Ctrl+F):
     ```javascript
     "/api/"
     "fetch("
     "XMLHttpRequest"
     "https://"
     "endpoint"
     "baseURL"
     "API_URL"
     ```

4. **Common Code Patterns**:
   ```javascript
   // Look for:
   const API_BASE = 'https://pay.rakuten.co.jp/api/v3';

   fetch(`${API_BASE}/stores?lat=${lat}&lng=${lng}`)

   axios.get('/api/shop/search', { params: { ... } })
   ```

### Method 3: Mobile App Inspection (Advanced)

If you have access to the Rakuten Pay mobile app:

1. **Use a Proxy Tool**:
   - [Charles Proxy](https://www.charlesproxy.com/)
   - [mitmproxy](https://mitmproxy.org/)
   - [Fiddler](https://www.telerik.com/fiddler)

2. **Configure Phone**:
   - Set phone to use proxy
   - Install SSL certificate
   - Open Rakuten Pay app

3. **Capture Traffic**:
   - Use store finder feature
   - Record all API calls
   - Extract endpoint URLs and parameters

### Method 4: Use Inspector Tool (Provided)

Open the included `inspect-rakuten-api.html` file:

```bash
# In your browser:
file:///home/user/stores/inspect-rakuten-api.html

# Or serve with:
python3 -m http.server 8000
# Then open: http://localhost:8000/inspect-rakuten-api.html
```

Follow the on-screen instructions.

## Expected API Structure

Based on your current code, the Rakuten Pay API likely follows this pattern:

### Endpoint 1: Get Stores by Location

```http
GET /mmeu/api/v3/stores
```

**Parameters**:
- `client_id`: `integrated` or similar
- `longitude`: GPS longitude (e.g., 139.7671)
- `latitude`: GPS latitude (e.g., 35.6812)
- `radius`: Search radius in meters (optional)
- `limit`: Max results (optional)

**Response**:
```json
{
  "stores": [
    {
      "map_store_id": "store_123",
      "store_name": "Example Store",
      "latitude": 35.6812,
      "longitude": 139.7671,
      // Postal code may or may not be included
    }
  ]
}
```

### Endpoint 2: Get Store Details

```http
GET /mmeu/api/v3/store/{map_store_id}
```

**Parameters**:
- `client_id`: `integrated`
- `map_store_id`: Store ID from list endpoint

**Response**:
```json
{
  "map_store_id": "store_123",
  "store_name": "Example Store",
  "postal_code": "100-0001",
  "address": "東京都千代田区千代田1-1-1",
  "latitude": 35.6812,
  "longitude": 139.7671,
  "phone": "03-1234-5678",
  // Additional store details
}
```

## Possible Endpoint Variations

The actual API might use different patterns:

```
# REST-style
https://pay.rakuten.co.jp/api/v3/stores
https://api.rakuten.co.jp/rpay/v2/shops

# GraphQL-style
https://pay.rakuten.co.jp/graphql
POST with query: { stores(lat: 35.6, lng: 139.7) { ... } }

# Legacy-style
https://pay.rakuten.co.jp/shop/search.json
https://map.rakuten.co.jp/getStores.php
```

## Next Steps

1. **Use the inspector tool** (`inspect-rakuten-api.html`)
2. **Document your findings** in a new file or update this one
3. **Update the KML generator** with the real endpoint:

   ```javascript
   // In kml-generator.js, update:
   const API_BASE_URL = 'https://pay.rakuten.co.jp/api/v3'; // Real endpoint
   ```

4. **Handle authentication** if required:
   ```javascript
   const headers = {
     'Authorization': 'Bearer YOUR_TOKEN',
     'X-Client-ID': 'YOUR_CLIENT_ID',
     // etc.
   };
   ```

## Questions to Answer

When you find the endpoint, document:

- [ ] Full endpoint URL
- [ ] Required query parameters
- [ ] Authentication method (API key, OAuth, cookies, etc.)
- [ ] Request headers needed
- [ ] Response structure
- [ ] Rate limits
- [ ] CORS restrictions
- [ ] Whether it's a public or private API

## Alternative: Contact Rakuten

If reverse engineering doesn't work:

1. **Rakuten Developers**: https://developers.rakuten.com/
2. **Rakuten Pay Merchant Support**: May have API access for merchants
3. **Rakuten Web Service**: https://webservice.rakuten.co.jp/

Request access to store location API if you're:
- A registered merchant
- Building an official integration
- Part of a partnership program

## Legal & Ethical Considerations

⚠️ **Important**:
- Respect robots.txt and terms of service
- Don't overwhelm servers with requests
- If it's a private API, seek official access
- Commercial use may require licensing
- Reverse engineering may violate ToS

## Summary

The Rakuten Pay store map API is **not publicly documented**. You'll need to:

1. Use browser DevTools to inspect network traffic
2. Find the actual endpoint URL and parameters
3. Understand authentication requirements
4. Update your code accordingly

Or:

5. Contact Rakuten for official API access
6. Use the existing localhost proxy if it works for your use case

---

**Created**: 2025-11-23
**For**: Rpay Store KML Generator Project
**Repository**: jsuk/stores
