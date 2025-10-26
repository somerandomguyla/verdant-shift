//module file for handling game damage calculations, etc.
function finalDamage(damage, defense, critChance, maxRandom) {
  let critical = false
  const damageRange = (Math.random() * 2 - 1) * maxRandom;
  let d = damage*1.1 * (100 / (100 + (defense/5))) * (1 + damageRange)
  if (Math.random() <= critChance) {
    d = d * 1.5
    critical = true
  }
  return [d, critical]
}

function calculateStats(base, cap, level) {
  return base + (base * (cap - 1)) * Math.sqrt((level - 1) / 99);
}

//How much the cap of a level should be in comparison to the base.
const statCapMultiplier = {defense: 3, attack: 4, hp: 8, critChance: 4}

module.exports = {
  finalDamage, calculateStats, statCapMultiplier
}