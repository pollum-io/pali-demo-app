const utils = require('./utils')
const ext = require('./bn-extensions')
const BN = require('bn.js')
// only add inputs if they don't bust the target value (aka, exact match)
// worst-case: O(n)
function blackjack (utxos, inputs, outputs, feeRate, assets, txVersion, memoSize) {
  if (!utils.uintOrNull(feeRate)) return {}
  const changeOutputBytes = utils.outputBytes({})
  let memoPadding = 0
  if (memoSize) {
    memoPadding = memoSize + 5 + 8 // opreturn overhead + memo size + amount int64
  }
  let feeBytes = new BN(changeOutputBytes.toNumber() + 4)
  let bytesAccum = utils.transactionBytes(inputs, outputs)
  let inAccum = utils.sumOrNaN(inputs)
  let outAccum = utils.sumOrNaN(outputs, txVersion)
  const memBytes = new BN(memoPadding)
  bytesAccum = ext.add(bytesAccum, memBytes)
  feeBytes = ext.add(feeBytes, memBytes)
  let fee = ext.mul(feeRate, bytesAccum)
  // is already enough input?
  if (ext.gte(inAccum, ext.add(outAccum, fee))) return utils.finalize(inputs, outputs, feeRate, changeOutputBytes)

  const threshold = utils.dustThreshold({}, feeRate)
  const dustAmount = utils.dustThreshold({ type: 'BECH32' }, feeRate)
  for (let i = 0; i < utxos.length; i++) {
    const input = utxos[i]
    const inputBytes = utils.inputBytes(input)
    fee = ext.mul(feeRate, ext.add(bytesAccum, inputBytes))
    const inputValue = utils.uintOrNull(input.value)

    // would it waste value?
    if (ext.gt(ext.add(inAccum, inputValue), ext.add(outAccum, fee, threshold))) continue

    bytesAccum = ext.add(bytesAccum, inputBytes)
    inAccum = ext.add(inAccum, inputValue)
    inputs.push(input)
    // if this is an asset input, we will need another output to send asset to so add dust satoshi to output and add output fee
    if (input.assetInfo) {
      const baseAssetID = utils.getBaseAssetID(input.assetInfo.assetGuid)
      outAccum = ext.add(outAccum, dustAmount)
      bytesAccum = ext.add(bytesAccum, utils.outputBytes({ type: 'BECH32' }))
      // double up to be safe
      bytesAccum = ext.add(bytesAccum, changeOutputBytes)
      feeBytes = ext.add(feeBytes, changeOutputBytes)
      // add another bech32 output for OP_RETURN overhead
      // any extra data should be optimized out later as OP_RETURN is serialized and fees are optimized
      bytesAccum = ext.add(bytesAccum, utils.outputBytes({ type: 'BECH32' }))
      fee = ext.mul(feeRate, bytesAccum)
      if (utils.isAssetAllocationTx(txVersion) && assets && assets.has(baseAssetID)) {
        const utxoAssetObj = assets.get(baseAssetID)
        // auxfee for this asset exists add another output
        if (txVersion === utils.SYSCOIN_TX_VERSION_ALLOCATION_SEND && baseAssetID === input.assetInfo.assetGuid && utxoAssetObj.auxfeedetails && utxoAssetObj.auxfeedetails.auxfeeaddress && utxoAssetObj.auxfeedetails.auxfees && utxoAssetObj.auxfeedetails.auxfees.length > 0) {
          outAccum = ext.add(outAccum, dustAmount)
          bytesAccum = ext.add(bytesAccum, changeOutputBytes)
          feeBytes = ext.add(feeBytes, changeOutputBytes)
          // add another bech32 output for OP_RETURN overhead
          // any extra data should be optimized out later as OP_RETURN is serialized and fees are optimized
          bytesAccum = ext.add(bytesAccum, changeOutputBytes)
          feeBytes = ext.add(feeBytes, changeOutputBytes)
        }
        // add bytes and fees for notary signature
        if (utxoAssetObj.notarykeyid && utxoAssetObj.notarykeyid.length > 0) {
          const sigBytes = new BN(65)
          bytesAccum = ext.add(bytesAccum, sigBytes)
          feeBytes = ext.add(feeBytes, sigBytes)
        }
      }
    }

    // go again?
    if (ext.lt(inAccum, ext.add(outAccum, fee))) continue

    return utils.finalize(inputs, outputs, feeRate, feeBytes)
  }
  return { fee: ext.mul(feeRate, bytesAccum) }
}

// average-case: O(n*log(n))
function blackjackAsset (utxos, assetMap, feeRate, txVersion, assets) {
  if (!utils.uintOrNull(feeRate)) return {}
  const isAsset = utils.isAsset(txVersion)
  const isNonAssetFunded = utils.isNonAssetFunded(txVersion)
  const dustAmount = utils.dustThreshold({ type: 'BECH32' }, feeRate)
  const mapAssetAmounts = new Map()
  const inputs = []
  const outputs = []
  const assetAllocations = []
  let auxfeeValue = ext.BN_ZERO
  for (let i = 0; i < utxos.length; i++) {
    const input = utxos[i]
    if (!input.assetInfo) {
      continue
    }
    mapAssetAmounts.set(input.assetInfo.assetGuid + '-' + input.assetInfo.value.toString(10), i)
  }

  // loop through all assets looking to get funded, sort the utxo's and then try to fund them incrementally
  for (const [assetGuid, valueAssetObj] of assetMap.entries()) {
    const baseAssetID = utils.getBaseAssetID(assetGuid)
    const utxoAssetObj = (assets && assets.get(baseAssetID)) || {}
    const assetAllocation = { assetGuid: assetGuid, values: [], notarysig: utxoAssetObj.notarysig || Buffer.from('') }
    if (!isAsset) {
      // auxfee is set and its an allocation send
      if (txVersion === utils.SYSCOIN_TX_VERSION_ALLOCATION_SEND && baseAssetID === assetGuid && utxoAssetObj.auxfeedetails && utxoAssetObj.auxfeedetails.auxfeeaddress && utxoAssetObj.auxfeedetails.auxfees && utxoAssetObj.auxfeedetails.auxfees.length > 0) {
        let totalAssetValue = ext.BN_ZERO
        // find total amount for this asset from assetMap
        valueAssetObj.outputs.forEach(output => {
          totalAssetValue = ext.add(totalAssetValue, output.value)
        })
        // get auxfee based on auxfee table and total amount sending
        auxfeeValue = utils.getAuxFee(utxoAssetObj.auxfeedetails, totalAssetValue)
        if (auxfeeValue.gt(ext.BN_ZERO)) {
          assetAllocation.values.push({ n: outputs.length, value: auxfeeValue })
          outputs.push({ address: utxoAssetObj.auxfeedetails.auxfeeaddress, type: 'BECH32', assetInfo: { assetGuid: assetGuid, value: auxfeeValue }, value: dustAmount })
        }
      }
    }
    valueAssetObj.outputs.forEach(output => {
      assetAllocation.values.push({ n: outputs.length, value: output.value })
      if (output.address === valueAssetObj.changeAddress) {
        // add change index
        outputs.push({ assetChangeIndex: assetAllocation.values.length - 1, type: 'BECH32', assetInfo: { assetGuid: assetGuid, value: output.value }, value: dustAmount })
      } else {
        outputs.push({ address: output.address, type: 'BECH32', assetInfo: { assetGuid: assetGuid, value: output.value }, value: dustAmount })
      }
    })
    let funded = txVersion === utils.SYSCOIN_TX_VERSION_ASSET_ACTIVATE
    let assetOutAccum = isAsset ? ext.BN_ZERO : utils.sumOrNaN(valueAssetObj.outputs)
    const hasZeroVal = utils.hasZeroVal(valueAssetObj.outputs)
    // if auxfee exists add total output for asset with auxfee so change is calculated properly
    if (!ext.eq(auxfeeValue, ext.BN_ZERO)) {
      assetOutAccum = ext.add(assetOutAccum, auxfeeValue)
    }
    // make sure if zero val is output, that zero val input is also added
    const indexZeroVal = mapAssetAmounts.get(assetGuid + '-' + ext.BN_ZERO.toString(10))
    if (hasZeroVal && !funded) {
      if (indexZeroVal) {
        inputs.push(utxos[indexZeroVal])
      }
      // if the required amount has filled because its 0, we've just added 0 we can exit right here
      if (assetOutAccum.isZero()) {
        funded = true
      }
    }
    if (!isNonAssetFunded) {
      // make sure total amount output exists
      const index = mapAssetAmounts.get(assetGuid + '-' + assetOutAccum.toString(10))
      // ensure every target for asset is satisfied otherwise we fail
      if (!funded && index) {
        inputs.push(utxos[index])
        funded = true
      }
      assetAllocations.push(assetAllocation)
      // shortcut when we know an asset spend is not funded
      if (!funded) {
        return utils.finalizeAssets(null, null, null, null, null)
      }
    } else {
      assetAllocations.push(assetAllocation)
    }
  }
  return utils.finalizeAssets(inputs, outputs, assetAllocations)
}

module.exports = {
  blackjack: blackjack,
  blackjackAsset: blackjackAsset
}
