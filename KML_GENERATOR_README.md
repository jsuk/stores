# Rpay Store KML Generator

A command-line tool to generate KML files for Google Maps showing an ordered list of rpay stores based on Japanese postal codes.

## Features

- ✅ **Postal Code Filtering**: Filter stores by Japanese postal code (e.g., 100-0001)
- ✅ **Route Optimization**: Automatically orders stores using nearest neighbor algorithm for efficient visiting
- ✅ **KML Generation**: Creates Google Maps compatible KML files with numbered markers and route lines
- ✅ **Smart Caching**: Caches store data for 24 hours to reduce API calls
- ✅ **Store Filtering**: Excludes common chain stores (convenience stores, fast food, etc.)
- ✅ **Postal Data Integration**: Integrates with Japanese postal code database for address lookup

## Prerequisites

- Node.js 14.x or higher
- Access to the rpay store API at `http://localhost:8080/mmeu/api/v3`
- Postal code data files in `zipcode/dl/roman/KEN_ALL_ROME.zip`

## Installation

1. Install dependencies:

```bash
npm install
```

2. Make the script executable (Linux/Mac):

```bash
chmod +x kml-generator.js
```

## Usage

### Basic Usage

Generate a KML file for a specific postal code:

```bash
node kml-generator.js 100-0001
```

Or with the postal code without hyphen:

```bash
node kml-generator.js 1000001
```

### Advanced Options

```bash
node kml-generator.js <postal-code> [options]
```

#### Options

- `-o, --output <file>`: Specify output KML file path (default: `route_<postalcode>.kml`)
- `--no-cache`: Skip cache and fetch fresh data from API
- `--center-lat <latitude>`: Center latitude for store search (default: 35.6812)
- `--center-lng <longitude>`: Center longitude for store search (default: 139.7671)
- `--no-optimize`: Skip route optimization (use store order as-is)
- `-h, --help`: Display help information
- `-V, --version`: Display version number

### Examples

#### Generate KML for postal code with custom output file:

```bash
node kml-generator.js 100-0001 -o my-stores.kml
```

#### Force fresh data fetch (skip cache):

```bash
node kml-generator.js 100-0001 --no-cache
```

#### Search stores around a specific location:

```bash
node kml-generator.js 100-0001 --center-lat 35.6895 --center-lng 139.6917
```

#### Generate KML without route optimization:

```bash
node kml-generator.js 100-0001 --no-optimize
```

#### Debug mode with stack traces:

```bash
DEBUG=1 node kml-generator.js 100-0001
```

## Output

The tool generates a KML file containing:

- **Numbered Placemarks**: Each store is marked with a number (1, 2, 3, ...)
- **Start Point**: First store marked in red
- **Store Points**: Subsequent stores marked in green
- **Route Line**: Blue line connecting all stores in order
- **Store Information**: Name, ID, postal code, and position in route

### KML File Structure

```xml
<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Rpay Stores Route - 1000001</name>
    <description>Route for postal code 1000001</description>
    <!-- Styles for markers and route line -->
    <!-- Placemarks for each store -->
    <!-- LineString for the route -->
  </Document>
</kml>
```

## How It Works

1. **Data Loading**: Loads postal code data from the ZIP file to validate and enrich postal code information
2. **Store Fetching**: Fetches all stores from the API (or loads from cache if available)
3. **Store Filtering**:
   - Filters out excluded chain stores
   - Filters stores matching the specified postal code
4. **Route Optimization**: Uses nearest neighbor algorithm to order stores for efficient visiting
5. **KML Generation**: Creates a KML file with markers, labels, and route line
6. **File Output**: Saves the KML file to disk

## Caching

The tool uses a `.cache` directory to store:

- **Store data**: Cached for 24 hours (`stores_with_details.json`)
- **Store details**: Individual store information with postal codes

Cache files are automatically refreshed after 24 hours or can be bypassed using `--no-cache`.

## Importing to Google Maps

1. Open [Google My Maps](https://www.google.com/maps/d/)
2. Click "Create a New Map"
3. Click "Import" in the left panel
4. Upload the generated KML file
5. View your rpay stores route with numbered markers!

## API Integration

The tool integrates with the following endpoints:

- `GET /mmeu/api/v3/stores?client_id=integrated&longitude={lng}&latitude={lat}`
  - Fetches all stores near a location
- `GET /mmeu/api/v3/store/{map_store_id}?client_id=integrated`
  - Fetches detailed information for a specific store (including postal code)

## Route Optimization Algorithm

The tool uses a **Nearest Neighbor** algorithm for route optimization:

1. Start at the first store (or specified start point)
2. Find the nearest unvisited store
3. Move to that store and mark it as visited
4. Repeat until all stores are visited

This provides a good approximation of the optimal route (TSP solution) with O(n²) time complexity.

## Troubleshooting

### No stores found for postal code

- Verify the postal code is correct
- Check if stores have postal code data by running with `--no-cache`
- Try a different center location with `--center-lat` and `--center-lng`

### API connection errors

- Ensure the rpay store API is running at `http://localhost:8080`
- Check network connectivity
- Verify API credentials and client_id

### Postal code not found in database

- The postal code might not exist in the KEN_ALL_ROME.zip file
- The tool will still work but won't show address details
- Check the postal code format (7 digits, with or without hyphen)

## File Structure

```
stores/
├── kml-generator.js          # Main CLI script
├── package.json              # Node.js dependencies
├── KML_GENERATOR_README.md   # This file
├── .cache/                   # Cache directory (auto-created)
│   └── stores_with_details.json
└── zipcode/dl/roman/         # Postal code data
    └── KEN_ALL_ROME.zip
```

## Dependencies

- **commander**: CLI argument parsing
- **node-fetch**: HTTP requests to API
- **adm-zip**: ZIP file handling for postal code data
- **iconv-lite**: Shift-JIS encoding support for Japanese postal data

## License

MIT

## Contributing

Contributions are welcome! Please ensure:

- Code follows existing style
- New features include documentation
- Test with various postal codes before submitting

## Related Files

- `stores.html`: Main web application with interactive map
- `postalDataService.js`: Postal code data service module
- `tsp-worker.js`: Web worker for TSP optimization
- `README.md`: Main project documentation
