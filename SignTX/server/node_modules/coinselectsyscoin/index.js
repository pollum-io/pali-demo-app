const accumulative = require('./accumulative')
const blackjack = require('./blackjack')
const utils = require('./utils')
const ext = require('./bn-extensions')

// order by descending value, minus the inputs approximate fee
function utxoScore (x, feeRate) {
  return ext.sub(x.value, ext.mul(feeRate, utils.inputBytes(x)))
}

function coinSelect (utxos, inputs, outputs, feeRate, assets, txVersion, memoSize) {
  let utxoSys = utxos.filter(utxo => !utxo.assetInfo)
  utxoSys = utxoSys.concat().sort(function (a, b) {
    return ext.sub(utxoScore(b, feeRate), utxoScore(a, feeRate))
  })
  const inputsCopy = inputs.slice(0)
  // attempt to use the blackjack strategy first (no change output)
  const base = blackjack.blackjack(utxoSys, inputs, outputs, feeRate, assets, txVersion, memoSize)
  if (base.inputs && base.inputs.length > 0) return base
  // reset inputs, in case of funding assets inputs passed into coinSelect may have assets prefunded and therefor we preserve inputs passed in
  // instead of accumulate between the two coin selection algorithms
  inputs = inputsCopy
  // else, try the accumulative strategy
  return accumulative.accumulative(utxoSys, inputs, outputs, feeRate, assets, txVersion, memoSize)
}

function coinSelectAsset (utxos, assetMap, feeRate, txVersion, assets) {
  const utxoAssets = utxos.filter(utxo => utxo.assetInfo !== undefined)
  // attempt to use the blackjack strategy first (no change output)
  const base = blackjack.blackjackAsset(utxoAssets, assetMap, feeRate, txVersion, assets)
  if (base.inputs && base.inputs.length > 0) return base

  // else, try the accumulative strategy
  return accumulative.accumulativeAsset(utxoAssets, assetMap, feeRate, txVersion, assets)
}
// create map of assets on inputs and outputs, compares the two and adds to outputs if any are not accounted for on inputs
// the goal is to either have new outputs created to match inputs or to update output change values to match input for each asset spent in transaction
function syncAllocationsWithInOut (assetAllocations, inputs, outputs, feeRate, txVersion, assets, assetMap) {
  const dustAmount = utils.dustThreshold({ type: 'BECH32' }, feeRate)
  const isAsset = utils.isAsset(txVersion)
  const isNonAssetFunded = utils.isNonAssetFunded(txVersion)
  const mapAssetsIn = new Map()
  const mapAssetsOut = new Map()
  inputs.forEach(input => {
    if (input.assetInfo) {
      if (!mapAssetsIn.has(input.assetInfo.assetGuid)) {
        mapAssetsIn.set(input.assetInfo.assetGuid, { value: ext.BN_ZERO, zeroval: false })
      }
      const assetAllocationValueIn = mapAssetsIn.get(input.assetInfo.assetGuid)
      assetAllocationValueIn.value = ext.add(assetAllocationValueIn.value, input.assetInfo.value)
      assetAllocationValueIn.zeroval = assetAllocationValueIn.zeroval || input.assetInfo.value.isZero()
      mapAssetsIn.set(input.assetInfo.assetGuid, assetAllocationValueIn)
    }
  })
  // get total output value from assetAllocations, not from outputs because outputs may have removed some outputs and redirected allocations to other outputs (ie burn sys to ethereum)
  assetAllocations.forEach(voutAsset => {
    voutAsset.values.forEach(output => {
      if (!mapAssetsOut.has(voutAsset.assetGuid)) {
        mapAssetsOut.set(voutAsset.assetGuid, { value: ext.BN_ZERO, zeroval: false })
      }
      const assetAllocationValueOut = mapAssetsOut.get(voutAsset.assetGuid)
      assetAllocationValueOut.value = ext.add(assetAllocationValueOut.value, output.value)
      assetAllocationValueOut.zeroval = assetAllocationValueOut.zeroval || output.value.isZero()
      mapAssetsOut.set(voutAsset.assetGuid, assetAllocationValueOut)
    })
  })
  for (const [assetGuid, valueAssetIn] of mapAssetsIn.entries()) {
    const assetAllocation = assetAllocations.find(voutAsset => voutAsset.assetGuid === assetGuid)
    // if we have outputs for this asset we need to either update them (if change exists) or create new output for that asset change
    if (mapAssetsOut.has(assetGuid)) {
      const valueAssetOut = mapAssetsOut.get(assetGuid)
      let valueDiff = ext.sub(valueAssetIn.value, valueAssetOut.value)
      // for the types of tx which create outputs without inputs we want to ensure valueDiff doesn't go negative
      // and account for inputs and outputs properly (discounting the amount requested in assetsMap)
      if (isAsset || isNonAssetFunded) {
        if (assetMap && assetMap.has(assetGuid)) {
          const valueOut = assetMap.get(assetGuid)
          const accumOut = utils.sumOrNaN(valueOut.outputs)
          valueDiff = ext.add(valueDiff, accumOut)
        }
      }
      if (valueDiff.isNeg()) {
        console.log('syncAllocationsWithInOut: asset output cannot be larger than input. Output: ' + valueAssetOut.value + ' Input: ' + valueAssetIn.value)
        return null
      // if zero and zeroval's match then we skip, zero val not matching should create output below if zeroval input exists but not output
      } else if (valueDiff.isZero() && valueAssetIn.zeroval === valueAssetOut.zeroval) {
        continue
      }
      if (assetAllocation === undefined) {
        console.log('syncAllocationsWithInOut: inconsistency related to outputs with asset and assetAllocation with asset guid: ' + assetGuid)
        return null
      }
      if (!valueAssetIn.zeroval && valueAssetOut.zeroval) {
        console.log('syncAllocationsWithInOut: input not zero val but output does have zero val for asset guid: ' + assetGuid)
        return null
      }
      const assetChangeOutputs = outputs.filter(output => (output.assetInfo !== undefined && output.assetInfo.assetGuid === assetGuid && output.assetChangeIndex !== undefined))
      // if change output already exists just set new value otherwise create new output and allocation
      // also if input has zero val input but output does not, also create new output instead of just updating existing
      // zeroval outputs denote asset ownership (different than asset allocation ownership which are the tokens inside of the asset)
      // also ensure that if this output is zero val we don't add to it, create new output (otherwise we will lose zero value and consensus will reject likely)
      if (assetChangeOutputs.length > 0 && !(valueAssetIn.zeroval && !valueAssetOut.zeroval) && !assetChangeOutputs[0].assetInfo.value.isZero()) {
        const assetChangeOutput = assetChangeOutputs[0]
        assetChangeOutput.assetInfo.value = ext.add(assetChangeOutput.assetInfo.value, valueDiff)
        assetAllocation.values[assetChangeOutput.assetChangeIndex].value = ext.add(assetAllocation.values[assetChangeOutput.assetChangeIndex].value, valueDiff)
      } else {
        assetAllocation.values.push({ n: outputs.length, value: valueDiff })
        outputs.push({ assetChangeIndex: assetAllocation.values.length - 1, type: 'BECH32', assetInfo: { assetGuid: assetGuid, value: valueDiff }, value: dustAmount })
      }
    // asset does not exist in output, create it
    } else {
      if (assetAllocation !== undefined) {
        console.log('syncAllocationsWithInOut: inconsistency related to outputs with NO asset and assetAllocation with asset guid: ' + assetGuid)
        return null
      }
      const baseAssetID = utils.getBaseAssetID(assetGuid)
      const valueDiff = valueAssetIn.value
      const utxoAssetObj = (assets && assets.get(baseAssetID)) || {}
      const allocation = { assetGuid: assetGuid, values: [{ n: outputs.length, value: valueDiff }], notarysig: utxoAssetObj.notarysig || Buffer.from('') }
      outputs.push({ assetChangeIndex: allocation.values.length - 1, type: 'BECH32', assetInfo: { assetGuid: assetGuid, value: valueDiff }, value: dustAmount })
      assetAllocations.push(allocation)
    }
  }
  return 1
}

function coinSelectAssetGas (assetAllocations, utxos, inputs, outputs, feeRate, txVersion, assets, assetMap, memoSize) {
  // select outputs and de-duplicate inputs already selected
  let utxoSys = utxos.filter(utxo => !inputs.find(input => input.txId === utxo.txId && input.vout === utxo.vout))
  utxoSys = utxoSys.concat().sort(function (a, b) {
    return ext.sub(utxoScore(b, feeRate), utxoScore(a, feeRate))
  })
  const inputsCopy = inputs.slice(0)
  // attempt to use the blackjack strategy first (no change output)
  const base = blackjack.blackjack(utxoSys, inputs, outputs, feeRate, assets, txVersion, memoSize)
  if (base.inputs && base.inputs.length > 0) {
    if (!syncAllocationsWithInOut(assetAllocations, base.inputs, base.outputs, feeRate, txVersion, assets, assetMap)) {
      return {}
    }
    return base
  }
  // reset inputs, in case of funding assets inputs passed into coinSelect may have assets prefunded and therefor we preserve inputs passed in
  // instead of accumulate between the two coin selection algorithms
  inputs = inputsCopy
  // else, try the accumulative strategy
  const res = accumulative.accumulative(utxoSys, inputs, outputs, feeRate, assets, txVersion, memoSize)
  if (res.inputs) {
    if (!syncAllocationsWithInOut(assetAllocations, res.inputs, res.outputs, feeRate, txVersion, assets, assetMap)) {
      return {}
    }
  }
  return res
}

module.exports = {
  coinSelect: coinSelect,
  coinSelectAsset: coinSelectAsset,
  coinSelectAssetGas: coinSelectAssetGas,
  utils: utils
}
