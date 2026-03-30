// Quote engine — matches the website's InstantEstimate.tsx formula exactly

const LABOR_RATE = 60
const MIN_STANDARD = 130
const MIN_DEEP = 225

// Square footage → labor units (3-tier)
function sqftToLabor(sqft) {
  if (sqft <= 1500) return sqft / 680
  if (sqft <= 3000) return 1500 / 680 + (sqft - 1500) / 1050
  return 1500 / 680 + 1500 / 1050 + (sqft - 3000) / 1400
}

// Bathroom adjustment (per bathroom above 1)
function bathroomUnits(bathrooms) {
  return Math.max(0, (bathrooms - 1) * 0.40)
}

// Condition adjustment
function conditionUnits(condition) {
  if (condition === 'heavy') return 1.0
  if (condition === 'moderate') return 0.5
  return 0 // maintenance
}

// Pet hair adjustment
function petHairUnits(petHair) {
  if (petHair === 'heavy') return 0.6
  if (petHair === 'some') return 0.3
  return 0 // none
}

// Deep clean multiplier (varies by sqft)
function deepCleanMultiplier(sqft) {
  if (sqft <= 1200) return 1.60
  if (sqft <= 2000) return 1.65
  if (sqft <= 3000) return 1.75
  return 1.80
}

// Frequency multiplier
function frequencyMultiplier(frequency) {
  if (frequency === 'weekly') return 0.85
  if (frequency === 'biweekly') return 1.0
  if (frequency === 'monthly') return 1.15
  return 1.50 // one-time
}

function roundTo5(n) {
  return Math.round(n / 5) * 5
}

export function calculateQuote({ sqft, serviceType, frequency, bathrooms, petHair, condition }) {
  sqft = parseInt(sqft) || 1500
  bathrooms = parseInt(bathrooms) || 2

  // Calculate labor units
  let labor = sqftToLabor(sqft) + bathroomUnits(bathrooms) + conditionUnits(condition) + petHairUnits(petHair)

  // Apply deep clean multiplier
  const isDeep = serviceType === 'deep' || serviceType === 'Deep Cleaning' || serviceType === 'move-in-out' || serviceType === 'Move-In/Move-Out'
  if (isDeep) {
    labor *= deepCleanMultiplier(sqft)
  }

  // Apply frequency multiplier
  const freqMult = frequencyMultiplier(frequency)
  const raw = labor * freqMult * LABOR_RATE

  // Round and apply minimum
  const minJob = isDeep ? MIN_DEEP : MIN_STANDARD
  const rounded = Math.max(minJob, roundTo5(raw))

  // Generate range (±4%)
  const estimateMin = roundTo5(rounded * 0.96)
  const estimateMax = roundTo5(rounded * 1.04)

  return {
    estimateMin,
    estimateMax,
    perClean: rounded,
    labor: Math.round(labor * 100) / 100,
    frequency,
    serviceType,
    isDeep,
    freqMultiplier: freqMult,
    breakdown: {
      sqftUnits: Math.round(sqftToLabor(sqft) * 100) / 100,
      bathroomUnits: bathroomUnits(bathrooms),
      conditionUnits: conditionUnits(condition),
      petHairUnits: petHairUnits(petHair),
    },
  }
}
