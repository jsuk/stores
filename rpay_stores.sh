#!/bin/bash

# Fetch rpay stores from Rakuten API
# Usage: ./rpay_stores.sh <latitude> <longitude>
# Example: ./rpay_stores.sh 35.6812 139.7671

if [ $# -lt 2 ]; then
    echo "Usage: $0 <latitude> <longitude>"
    echo "Example: $0 35.6812 139.7671"
    exit 1
fi

latitude=$1
longitude=$2

echo "Fetching rpay stores for location: $latitude, $longitude"
echo "API: https://gateway-api.global.rakuten.com/mmeu/api/v3/stores"
echo ""

curl -s "https://gateway-api.global.rakuten.com/mmeu/api/v3/stores?latitude=$latitude&longitude=$longitude&client_id=integrated" \
  | tee "rpay_stores_${latitude}_${longitude}.json" \
  | jq -r '.stores[] | select(.service_id[]| any(.; . == "rpay")) | "\(.store_name),\(.latitude),\(.longitude)"'

echo ""
echo "Results saved to: rpay_stores_${latitude}_${longitude}.json"
