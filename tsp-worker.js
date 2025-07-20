function nearestNeighborTsp(distanceMatrix) {
    const n = distanceMatrix.length;
    if (n === 0) return [];

    // Send initial progress
    self.postMessage({ type: 'progress', count: 0, total: n });

    let unvisited = new Set(Array.from({ length: n }, (_, i) => i));
    let path = [];
    let currentCity = 0; // Start at the first city

    path.push(currentCity);
    unvisited.delete(currentCity);

    // Send progress after finding first city
    self.postMessage({ type: 'progress', count: 1, total: n });

    while (unvisited.size > 0) {
        let nearestCity = -1;
        let minDistance = Infinity;

        for (const city of unvisited) {
            if (distanceMatrix[currentCity][city] < minDistance) {
                minDistance = distanceMatrix[currentCity][city];
                nearestCity = city;
            }
        }

        if (nearestCity === -1) {
            // This can happen if remaining nodes are disconnected.
            // Stop and return the partial path.
            break;
        }

        path.push(nearestCity);
        unvisited.delete(nearestCity);
        currentCity = nearestCity;

        // Send progress update
        self.postMessage({ type: 'progress', count: path.length, total: n });
    }

    return path;
}

self.onmessage = function(e) {
    try {
        const distanceMatrix = e.data;
        if (!distanceMatrix || distanceMatrix.length === 0) {
            self.postMessage({ type: 'result', result: [] });
            return;
        }
        const result = nearestNeighborTsp(distanceMatrix);
        self.postMessage({ type: 'result', result });
    } catch (error) {
        self.postMessage({ type: 'error', error: error.message });
    }
};