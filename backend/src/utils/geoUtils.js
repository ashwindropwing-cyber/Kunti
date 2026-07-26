/**
 * Haversine formula to calculate straight-line distance between two GPS coordinates (in km).
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const R = 6371; // Earth radius in KM

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
    Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) *
    Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculates estimated road distance (Haversine * 1.3 multiplier) without external Google API calls.
 */
async function calculateRoadDistance(lat1, lon1, lat2, lon2) {
  if (!lat1 || !lon1 || !lat2 || !lon2) {
    return 0;
  }
  const straightDistance = calculateDistance(lat1, lon1, lat2, lon2);
  // Estimate road winding factor (~1.3x straight line)
  return parseFloat((straightDistance * 1.3).toFixed(2));
}

module.exports = { calculateDistance, calculateRoadDistance };

