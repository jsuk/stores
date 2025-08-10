# SPARQL Geo Query Tool

A web-based tool that performs progressive SPARQL queries against the Japanese e-Stat LOD (Linked Open Data) endpoint to find Japanese administrative divisions containing a given geographic point, with integrated postal code lookup.

## Features

- **Three-stage progressive loading** for optimal performance
- **Interactive map** displaying area boundaries
- **Bilingual support** (Japanese and English names)
- **Postal code lookup** with full address matching
- **Caching system** for improved performance
- **Real-time location detection** via browser geolocation

## How It Works

### Stage 1: Geometry First (Fastest ~200-500ms)
```sparql
SELECT ?geom ?area_entity
WHERE {
    ?area_entity geo:hasGeometry/geo:asWKT ?geom .
    FILTER(ogcf:sfContains(?geom, "POINT(longitude latitude)"^^geo:wktLiteral)) .
    FILTER(STRSTARTS(STR(?area_entity), "http://data.e-stat.go.jp/lod/smallArea"))
}
```
- **Purpose**: Get geographic boundary immediately
- **Result**: Map displays with area outline
- **Performance**: Optimized for visual feedback

### Stage 2: Japanese Names (Fast ~500-800ms)
```sparql
SELECT ?area_ja ?parent1 ?parent1_ja ?parent2 ?parent2_ja
WHERE {
    <area_entity> rdfs:label ?area_ja .
    FILTER(LANG(?area_ja) = 'ja')
    OPTIONAL {
        <area_entity> dcterms:isPartOf ?parent1 .
        ?parent1 rdfs:label ?parent1_ja .
        FILTER(LANG(?parent1_ja) = 'ja')
        OPTIONAL {
            ?parent1 dcterms:isPartOf ?parent2 .
            ?parent2 rdfs:label ?parent2_ja .
            FILTER(LANG(?parent2_ja) = 'ja')
        }
    }
}
```
- **Purpose**: Get Japanese administrative names
- **Result**: Prefecture (都道府県), Municipality (市町村区), Area names
- **Logic**: Uses suffix patterns to identify administrative levels

### Stage 3: English Translations (Background ~300-600ms)
```sparql
SELECT ?prefecture_en ?municipality_en ?area_en
WHERE {
    OPTIONAL { <area_entity> rdfs:label ?area_en . FILTER(LANG(?area_en) = 'en') . }
    OPTIONAL { <municipality_entity> rdfs:label ?municipality_en . FILTER(LANG(?municipality_en) = 'en') . }
    OPTIONAL { <prefecture_entity> rdfs:label ?prefecture_en . FILTER(LANG(?prefecture_en) = 'en') . }
}
```
- **Purpose**: Get English translations if available
- **Result**: English administrative names
- **Fallback**: Shows "N/A" if translations unavailable

## Data Sources

### SPARQL Endpoint
- **URL**: `https://data.e-stat.go.jp/lod/sparql/alldata/query`
- **Provider**: Japanese Ministry of Internal Affairs and Communications
- **Data**: Administrative boundaries and names from Japanese census

### Postal Code Data
- **Source**: Japan Post postal code database
- **Format**: CSV with Japanese and romanized addresses
- **Integration**: Local IndexedDB caching for fast lookup

## Administrative Hierarchy

The tool handles the Japanese administrative structure:

```
Prefecture (都道府県)
└── Municipality (市町村区)
    └── Small Area (小地域/丁目)
```

### Entity URI Patterns
- **Small Area**: `http://data.e-stat.go.jp/lod/smallArea/g00200521/2015/S11201039002`
- **Municipality**: `http://data.e-stat.go.jp/lod/sac/C11201-20030401`  
- **Prefecture**: `http://data.e-stat.go.jp/lod/sac/C11000-19700401`

## Usage Steps

1. **Open**: `query.html` in a web browser
2. **Enter**: Longitude and latitude coordinates
3. **Click**: "Query" button
4. **Watch**: Progressive loading stages
   - Map appears immediately
   - Japanese names load next
   - English translations load in background
5. **Explore**: Click map center button to get coordinates from map
6. **Search**: Use address search for postal code lookup

## Technical Implementation

### Progressive Loading Benefits
- **Immediate Feedback**: Users see results in 200-500ms
- **Non-blocking**: Later stages don't delay initial response  
- **Graceful Degradation**: Works even if some stages fail
- **Caching**: Complete results cached for repeat queries

### Performance Optimizations
1. **Geometry-first approach**: Minimal initial query for fast map display
2. **Entity URI extraction**: Stage 1 provides URIs for targeted Stage 2/3 queries
3. **In-memory caching**: Prevents duplicate SPARQL requests
4. **Background loading**: English translations don't block user interaction

### Error Handling
- **Network failures**: Graceful fallbacks with "N/A" values
- **Missing data**: OPTIONAL clauses prevent query failures
- **HTTP errors**: Detailed error messages for debugging

## Example Output

For coordinates `139.48, 35.92`:

```json
{
  "prefecture_ja": "埼玉県",
  "prefecture_en": "Saitama-ken", 
  "municipality_ja": "川越市",
  "municipality_en": "Kawagoe-shi",
  "area_ja": "六軒町２丁目",
  "area_en": "N/A",
  "full_address_ja": "埼玉県 川越市 六軒町２丁目",
  "postal_candidates": [
    {
      "postalCode": "350-0043",
      "address": "埼玉県川越市新富町"
    }
  ]
}
```

## File Structure

- `query.html` - Main application with progressive SPARQL queries
- `postalDataService.js` - Postal code lookup with IndexedDB caching
- `utils.js` - Utility functions
- `KEN_ALL_ROME.CSV` - Japanese postal code database
- `README.md` - This documentation

## Browser Requirements

- **Modern browser** with ES6+ support
- **Geolocation API** for location detection
- **IndexedDB** for postal code caching
- **Leaflet.js** for map rendering
- **WellKnown.js** for WKT geometry parsing

## Performance Metrics

- **Stage 1**: 200-500ms (geometry + map)
- **Stage 2**: +500-800ms (Japanese names)  
- **Stage 3**: +300-600ms (English translations)
- **Total**: ~1-2 seconds for complete data
- **Cached**: <100ms for repeat queries